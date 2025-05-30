import { useState, useRef, useCallback, useEffect } from "react";
import { createPeerConnection, createFileChunks, reassembleFile } from "@/lib/webrtc-utils";
import type { WSMessage } from "@shared/schema";

interface UseWebRTCProps {
  deviceId: string;
  sendMessage: (message: WSMessage) => void;
  onTransferComplete: (transferId: string) => void;
}

interface TransferState {
  transferId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  senderId: string;
  receiverId: string;
  status: string;
  progress: number;
  peerConnection?: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  file?: File;
  chunks?: ArrayBuffer[];
  totalChunks?: number;
  receivedChunks?: number;
}

export function useWebRTC({ deviceId, sendMessage, onTransferComplete }: UseWebRTCProps) {
  const [transfers, setTransfers] = useState<Record<string, TransferState>>({});
  const transfersRef = useRef<Record<string, TransferState>>({});
  const fallbackTriggered = useRef<Set<string>>(new Set());
  const downloadTriggered = useRef<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => {
    transfersRef.current = transfers;
  }, [transfers]);

  const updateTransfer = useCallback((transferId: string, updates: Partial<TransferState>) => {
    setTransfers(prev => {
      const updated = {
        ...prev,
        [transferId]: { ...prev[transferId], ...updates }
      };
      transfersRef.current = updated;
      return updated;
    });
  }, []);

  const handleWebRTCMessage = useCallback(async (event: CustomEvent) => {
    const message = event.detail;
    let transfer = transfersRef.current[message.transferId];
    
    // For transfer-complete, handle auto-download for receiving devices
    if (message.type === 'transfer-complete') {
      console.log(`Received transfer complete notification for ${message.transferId}`);
      
      // Prevent duplicate downloads
      if (downloadTriggered.current.has(message.transferId)) {
        console.log(`Download already triggered for ${message.transferId}, skipping`);
        return;
      }
      
      // Mark download as triggered
      downloadTriggered.current.add(message.transferId);
      
      // Just mark the transfer as completed, don't auto-download
      console.log(`Transfer ${message.transferId} completed - waiting for user action`);
      
      // Clean up download tracking
      downloadTriggered.current.delete(message.transferId);
      return;
    }
    
    // For webrtc-offer, we need to create the transfer record if it doesn't exist (receiver side)
    if (!transfer && message.type === 'webrtc-offer') {
      // This must be from a transfer-offer that was accepted
      // We need to create a minimal transfer record for the receiver
      const receiverTransfer: TransferState = {
        transferId: message.transferId,
        fileName: 'Incoming file', // Will be updated when metadata arrives
        fileSize: 0, // Will be updated when metadata arrives
        fileType: 'application/octet-stream', // Will be updated when metadata arrives
        senderId: '', // Will be determined from WebRTC
        receiverId: deviceId,
        status: 'connecting',
        progress: 0,
        chunks: [],
        receivedChunks: 0,
        totalChunks: 0
      };
      
      updateTransfer(message.transferId, receiverTransfer);
      transfer = receiverTransfer;
    }
    
    if (!transfer) return;

    switch (message.type) {
      case 'transfer-answer':
        if (message.accepted) {
          await initiateWebRTCConnection(transfer);
        } else {
          updateTransfer(message.transferId, { status: 'rejected' });
        }
        break;
      
      case 'webrtc-offer':
        await handleWebRTCOffer(transfer, message.offer);
        break;
      
      case 'webrtc-answer':
        await handleWebRTCAnswer(transfer, message.answer);
        break;
      
      case 'webrtc-ice-candidate':
        await handleICECandidate(transfer, message.candidate);
        break;
    }
  }, [deviceId, updateTransfer]);

  const fallbackToServerTransfer = useCallback(async (transfer: TransferState) => {
    // 防重复处理：确保每个传输只会触发一次服务器中继
    if (!transfer.file || 
        transfer.status === 'transferring' || 
        transfer.status === 'completed' ||
        transfer.status === 'failed' ||
        fallbackTriggered.current.has(transfer.transferId)) {
      console.log(`Skipping fallback for ${transfer.transferId} - already processed or in progress`);
      return;
    }
    
    // 标记中继已启动，防止重复触发
    fallbackTriggered.current.add(transfer.transferId);
    
    console.log(`Using server fallback for ${transfer.transferId} - ensuring 100% delivery success`);
    updateTransfer(transfer.transferId, { status: 'transferring', progress: 10 });
    
    // 多重重试机制：确保在各种网络环境和服务器负载情况下都能成功
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        console.log(`Server upload attempt ${retryCount + 1}/${maxRetries} for ${transfer.fileName} (${transfer.fileSize} bytes)`);
        
        // 添加请求超时控制，防止长时间hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          console.log('Upload request timed out after 30 seconds');
        }, 30000);
        
        const response = await fetch(`/api/transfer/${transfer.transferId}/upload`, {
          method: 'POST',
          headers: {
            'X-Filename': encodeURIComponent(transfer.fileName),
            'Content-Type': transfer.fileType,
            'X-Transfer-Id': transfer.transferId,
            'X-Retry-Count': retryCount.toString(),
            'X-Client-Timestamp': Date.now().toString()
          },
          body: transfer.file,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log(`Server upload response: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          const result = await response.json();
          console.log(`Server upload successful on attempt ${retryCount + 1}:`, result);
          updateTransfer(transfer.transferId, { status: 'completed', progress: 100 });
          onTransferComplete(transfer.transferId);
          
          // 成功后清理追踪记录
          setTimeout(() => {
            fallbackTriggered.current.delete(transfer.transferId);
          }, 5000);
          return; // 成功后立即退出重试循环
        } else {
          // 服务器返回错误状态，解析具体错误信息
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
      } catch (error) {
        retryCount++;
        const errorObj = error as Error;
        const isAbortError = errorObj?.name === 'AbortError';
        const isNetworkError = error instanceof TypeError;
        const isLastAttempt = retryCount >= maxRetries;
        
        console.error(`Upload attempt ${retryCount} failed:`, {
          error: errorObj?.message || 'Unknown error',
          type: isAbortError ? 'timeout' : isNetworkError ? 'network' : 'server',
          isLastAttempt
        });
        
        if (isLastAttempt) {
          // 所有重试失败，记录详细错误信息
          console.error(`All ${maxRetries} upload attempts failed for ${transfer.transferId}`);
          updateTransfer(transfer.transferId, { 
            status: 'failed', 
            progress: 0
          });
          fallbackTriggered.current.delete(transfer.transferId);
          return;
        }
        
        // 指数退避策略：逐渐增加重试间隔，避免服务器过载
        const backoffDelay = Math.min(Math.pow(2, retryCount - 1) * 1000, 8000); // 最大8秒
        console.log(`Retrying upload in ${backoffDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        
        // 更新传输进度，显示重试状态
        updateTransfer(transfer.transferId, { 
          progress: 10 + (retryCount * 20), // 每次重试增加20%进度
          status: 'transferring'
        });
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }, [updateTransfer, onTransferComplete]);

  useEffect(() => {
    const eventHandler = (event: Event) => handleWebRTCMessage(event as CustomEvent);
    window.addEventListener('webrtc-message', eventHandler);
    return () => {
      window.removeEventListener('webrtc-message', eventHandler);
    };
  }, [handleWebRTCMessage]);

  const sendFile = useCallback(async (file: File, receiverId: string) => {
    const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const transfer: TransferState = {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      senderId: deviceId,
      receiverId,
      status: 'pending',
      progress: 0,
      file
    };

    updateTransfer(transferId, transfer);

    // Send transfer offer and wait for user acceptance
    sendMessage({
      type: 'transfer-offer',
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      senderId: deviceId,
      receiverId
    });

    console.log(`Transfer offer sent for ${file.name}, waiting for user response`);
    
    // Don't start WebRTC connection yet - wait for transfer-answer message
    // The connection will be initiated when we receive the acceptance

    return transferId;
  }, [deviceId, sendMessage, updateTransfer]);

  const acceptTransfer = useCallback((transferId: string) => {
    sendMessage({
      type: 'transfer-answer',
      transferId,
      accepted: true
    });
  }, [sendMessage]);

  const rejectTransfer = useCallback((transferId: string) => {
    sendMessage({
      type: 'transfer-answer',
      transferId,
      accepted: false
    });
  }, [sendMessage]);

  const initiateWebRTCConnection = useCallback(async (transfer: TransferState) => {
    try {
      // 防重复连接：检查是否已存在连接，避免资源浪费
      const existingTransfer = transfersRef.current[transfer.transferId];
      if (existingTransfer && existingTransfer.peerConnection) {
        console.log(`WebRTC connection already exists for ${transfer.transferId}`);
        return;
      }
      
      console.log(`Initiating WebRTC connection for ${transfer.transferId}`);
      const peerConnection = createPeerConnection();
      
      // 连接状态监控：实时监测WebRTC连接状态，快速响应失败情况
      peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state changed to: ${peerConnection.connectionState}`);
        
        // WebRTC连接成功时更新状态
        if (peerConnection.connectionState === 'connected') {
          updateTransfer(transfer.transferId, { status: 'connected' });
        }
        
        // 连接失败立即触发服务器中继，确保传输不中断
        if (peerConnection.connectionState === 'failed') {
          console.log('Connection failed - falling back to server relay');
          fallbackToServerTransfer(transfer);
        }
      };
      
      // ICE连接监控：监控ICE连接状态，处理网络环境问题
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state changed to: ${peerConnection.iceConnectionState}`);
        
        // ICE连接成功时记录
        if (peerConnection.iceConnectionState === 'connected' || 
            peerConnection.iceConnectionState === 'completed') {
          console.log('ICE connection established successfully');
        }
        
        // ICE连接失败或断开时立即切换到服务器中继
        // 这种情况通常由NAT、防火墙或网络配置问题引起
        if (peerConnection.iceConnectionState === 'failed' || 
            peerConnection.iceConnectionState === 'disconnected') {
          console.log('ICE connection failed - falling back to server relay');
          fallbackToServerTransfer(transfer);
        }
      };
      
      // 超时保护机制：3秒内未建立连接则自动切换到服务器中继
      // 这确保即使在复杂网络环境下也能快速切换到可靠的传输方式
      const connectionTimeout = setTimeout(() => {
        const currentTransfer = transfersRef.current[transfer.transferId];
        if (currentTransfer && 
            (currentTransfer.status === 'connecting' || currentTransfer.status === 'pending')) {
          console.log('WebRTC connection timeout (3s) - falling back to server relay for guaranteed delivery');
          fallbackToServerTransfer(currentTransfer);
        }
      }, 3000); // 缩短到3秒以提高响应速度
      
      // 成功建立连接后清除超时定时器
      peerConnection.addEventListener('connectionstatechange', () => {
        if (peerConnection.connectionState === 'connected') {
          clearTimeout(connectionTimeout);
        }
      });
      
      const dataChannel = peerConnection.createDataChannel('fileTransfer', {
        ordered: true,
        maxPacketLifeTime: 3000
      });

      updateTransfer(transfer.transferId, { 
        peerConnection, 
        dataChannel, 
        status: 'connecting' 
      });

      setupDataChannel(dataChannel, transfer.transferId, true);

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`Sending ICE candidate for ${transfer.transferId}`);
          sendMessage({
            type: 'webrtc-ice-candidate',
            transferId: transfer.transferId,
            candidate: event.candidate
          });
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      console.log(`Sending WebRTC offer for ${transfer.transferId}`);

      sendMessage({
        type: 'webrtc-offer',
        transferId: transfer.transferId,
        offer
      });
    } catch (error) {
      console.error('Failed to initiate WebRTC connection:', error);
      updateTransfer(transfer.transferId, { status: 'failed' });
    }
  }, [sendMessage, updateTransfer]);

  const handleWebRTCOffer = useCallback(async (transfer: TransferState, offer: RTCSessionDescriptionInit) => {
    try {
      console.log(`Handling WebRTC offer for ${transfer.transferId}`);
      const peerConnection = createPeerConnection();
      
      peerConnection.onconnectionstatechange = () => {
        console.log(`Receiver connection state changed to: ${peerConnection.connectionState}`);
      };
      
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`Receiver ICE connection state changed to: ${peerConnection.iceConnectionState}`);
      };
      
      updateTransfer(transfer.transferId, { 
        peerConnection, 
        status: 'connecting',
        chunks: [],
        receivedChunks: 0
      });

      peerConnection.ondatachannel = (event) => {
        console.log(`Data channel received for ${transfer.transferId}`);
        const dataChannel = event.channel;
        updateTransfer(transfer.transferId, { dataChannel });
        setupDataChannel(dataChannel, transfer.transferId, false);
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`Receiver sending ICE candidate for ${transfer.transferId}`);
          sendMessage({
            type: 'webrtc-ice-candidate',
            transferId: transfer.transferId,
            candidate: event.candidate
          });
        }
      };

      await peerConnection.setRemoteDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log(`Sending WebRTC answer for ${transfer.transferId}`);

      sendMessage({
        type: 'webrtc-answer',
        transferId: transfer.transferId,
        answer
      });
    } catch (error) {
      console.error('Failed to handle WebRTC offer:', error);
      updateTransfer(transfer.transferId, { status: 'failed' });
    }
  }, [sendMessage, updateTransfer]);

  const handleWebRTCAnswer = useCallback(async (transfer: TransferState, answer: RTCSessionDescriptionInit) => {
    try {
      if (transfer.peerConnection) {
        await transfer.peerConnection.setRemoteDescription(answer);
      }
    } catch (error) {
      console.error('Failed to handle WebRTC answer:', error);
    }
  }, []);

  const handleICECandidate = useCallback(async (transfer: TransferState, candidate: RTCIceCandidateInit) => {
    try {
      if (transfer.peerConnection && 
          transfer.peerConnection.connectionState !== 'failed' &&
          transfer.peerConnection.connectionState !== 'closed') {
        await transfer.peerConnection.addIceCandidate(candidate);
      }
    } catch (error) {
      console.error('Failed to handle ICE candidate:', error);
      // Don't retry on ICE candidate errors, just log and continue
    }
  }, []);

  const setupDataChannel = useCallback((dataChannel: RTCDataChannel, transferId: string, isSender: boolean) => {
    console.log(`Setting up data channel for ${transferId}, isSender: ${isSender}`);
    
    dataChannel.onopen = () => {
      console.log(`Data channel opened for ${transferId}, readyState: ${dataChannel.readyState}`);
      updateTransfer(transferId, { status: 'connected' });
      
      if (isSender) {
        console.log(`Starting file transfer for ${transferId}`);
        startFileTransfer(transferId);
      }
    };

    dataChannel.onmessage = (event) => {
      console.log(`Data channel message received for ${transferId}, size: ${event.data.length}`);
      if (!isSender) {
        handleFileChunk(transferId, event.data);
      }
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error for ${transferId}:`, error);
      updateTransfer(transferId, { status: 'failed' });
    };

    dataChannel.onclose = () => {
      console.log(`Data channel closed for ${transferId}`);
    };
  }, [updateTransfer]);

  const startFileTransfer = useCallback(async (transferId: string) => {
    const transfer = transfersRef.current[transferId];
    if (!transfer?.file || !transfer.dataChannel) return;

    updateTransfer(transferId, { status: 'transferring' });

    try {
      const chunks = await createFileChunks(transfer.file);
      updateTransfer(transferId, { totalChunks: chunks.length });

      // Send file metadata first
      const metadata = {
        type: 'metadata',
        fileName: transfer.fileName,
        fileSize: transfer.fileSize,
        fileType: transfer.fileType,
        totalChunks: chunks.length
      };
      
      transfer.dataChannel.send(JSON.stringify(metadata));

      // Send chunks with progress updates
      for (let i = 0; i < chunks.length; i++) {
        if (transfer.dataChannel.readyState === 'open') {
          const chunkData = {
            type: 'chunk',
            index: i,
            data: Array.from(new Uint8Array(chunks[i]))
          };
          
          transfer.dataChannel.send(JSON.stringify(chunkData));
          
          const progress = Math.round(((i + 1) / chunks.length) * 100);
          updateTransfer(transferId, { progress });
          
          sendMessage({
            type: 'transfer-progress',
            transferId,
            progress
          });

          // Small delay to prevent overwhelming the channel
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }

      updateTransfer(transferId, { status: 'completed', progress: 100 });
      sendMessage({
        type: 'transfer-complete',
        transferId
      });
      
      onTransferComplete(transferId);
    } catch (error) {
      console.error('File transfer failed:', error);
      updateTransfer(transferId, { status: 'failed' });
      sendMessage({
        type: 'transfer-error',
        transferId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [updateTransfer, sendMessage, onTransferComplete]);

  const handleFileChunk = useCallback(async (transferId: string, data: any) => {
    const transfer = transfersRef.current[transferId];
    if (!transfer) return;

    try {
      const message = JSON.parse(data);
      
      if (message.type === 'metadata') {
        updateTransfer(transferId, {
          fileName: message.fileName,
          fileSize: message.fileSize,
          fileType: message.fileType,
          totalChunks: message.totalChunks,
          chunks: new Array(message.totalChunks),
          receivedChunks: 0
        });
      } else if (message.type === 'chunk') {
        const chunks = transfer.chunks || [];
        chunks[message.index] = new Uint8Array(message.data).buffer;
        
        const receivedChunks = (transfer.receivedChunks || 0) + 1;
        const progress = Math.round((receivedChunks / (transfer.totalChunks || 1)) * 100);
        
        updateTransfer(transferId, {
          chunks,
          receivedChunks,
          progress
        });

        sendMessage({
          type: 'transfer-progress',
          transferId,
          progress
        });

        // Check if all chunks received
        if (receivedChunks === transfer.totalChunks) {
          try {
            console.log(`File transfer complete: ${transfer.fileName}`);
            const file = await reassembleFile(chunks, transfer.fileName, transfer.fileType);
            
            // Force download to user's computer
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = transfer.fileName;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Clean up object URL after a short delay to ensure download starts
            setTimeout(() => {
              URL.revokeObjectURL(url);
            }, 1000);

            updateTransfer(transferId, { status: 'completed', progress: 100 });
            sendMessage({
              type: 'transfer-complete',
              transferId
            });
            
            console.log(`Download triggered for: ${transfer.fileName}`);
            onTransferComplete(transferId);
          } catch (error) {
            console.error('Failed to download file:', error);
            updateTransfer(transferId, { status: 'failed' });
          }
        }
      }
    } catch (error) {
      console.error('Failed to handle file chunk:', error);
    }
  }, [updateTransfer, sendMessage, onTransferComplete]);

  const handleServerTransferComplete = useCallback(async (transferId: string) => {
    console.log(`Downloading file via server for ${transferId}`);
    
    try {
      const response = await fetch(`/api/transfer/${transferId}/download`);
      if (!response.ok) {
        throw new Error('Download failed');
      }
      
      const blob = await response.blob();
      const transfer = transfersRef.current[transferId];
      const fileName = transfer?.fileName || 'download';
      
      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      updateTransfer(transferId, { status: 'completed', progress: 100 });
      onTransferComplete(transferId);
    } catch (error) {
      console.error('Server download failed:', error);
      updateTransfer(transferId, { status: 'failed' });
    }
  }, [updateTransfer, onTransferComplete]);

  // Listen for server transfer complete messages
  useEffect(() => {
    const handleServerComplete = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail.type === 'transfer-complete') {
        const transfer = transfersRef.current[customEvent.detail.transferId];
        if (transfer && transfer.receiverId === deviceId) {
          handleServerTransferComplete(customEvent.detail.transferId);
        }
      }
    };
    
    window.addEventListener('webrtc-message', handleServerComplete);
    return () => window.removeEventListener('webrtc-message', handleServerComplete);
  }, [deviceId, handleServerTransferComplete]);

  return {
    transfers,
    sendFile,
    acceptTransfer,
    rejectTransfer
  };
}
