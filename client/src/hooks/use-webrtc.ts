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
    // Prevent duplicate fallback attempts
    if (!transfer.file || 
        transfer.status === 'transferring' || 
        transfer.status === 'completed' ||
        transfer.status === 'failed' ||
        fallbackTriggered.current.has(transfer.transferId)) {
      console.log(`Skipping fallback for ${transfer.transferId} - already processed or in progress`);
      return;
    }
    
    // Mark this transfer as having fallback triggered
    fallbackTriggered.current.add(transfer.transferId);
    
    console.log(`Using server fallback for ${transfer.transferId}`);
    updateTransfer(transfer.transferId, { status: 'transferring', progress: 10 });
    
    try {
      console.log(`Starting server upload for ${transfer.fileName} (${transfer.fileSize} bytes)`);
      console.log(`Upload URL: /api/transfer/${transfer.transferId}/upload`);
      console.log(`Headers:`, {
        'X-Filename': encodeURIComponent(transfer.fileName),
        'Content-Type': transfer.fileType,
        'X-Transfer-Id': transfer.transferId
      });
      
      const response = await fetch(`/api/transfer/${transfer.transferId}/upload`, {
        method: 'POST',
        headers: {
          'X-Filename': encodeURIComponent(transfer.fileName),
          'Content-Type': transfer.fileType,
          'X-Transfer-Id': transfer.transferId
        },
        body: transfer.file
      });
      
      console.log(`Server upload response: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const result = await response.json();
        console.log(`Server upload successful:`, result);
        updateTransfer(transfer.transferId, { status: 'completed', progress: 100 });
        onTransferComplete(transfer.transferId);
        // Clean up fallback tracking after a delay
        setTimeout(() => {
          fallbackTriggered.current.delete(transfer.transferId);
        }, 5000);
      } else {
        const errorText = await response.text();
        console.error(`Server upload failed: ${response.status} - ${errorText}`);
        throw new Error(`Server upload failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Fallback transfer failed:', error);
      updateTransfer(transfer.transferId, { status: 'failed' });
      fallbackTriggered.current.delete(transfer.transferId);
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

    // Send transfer offer for WebRTC negotiation
    sendMessage({
      type: 'transfer-offer',
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      senderId: deviceId,
      receiverId
    });

    // Try WebRTC connection
    await initiateWebRTCConnection(transfer);

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
      // Prevent duplicate connection attempts
      const existingTransfer = transfersRef.current[transfer.transferId];
      if (existingTransfer && existingTransfer.peerConnection) {
        console.log(`WebRTC connection already exists for ${transfer.transferId}`);
        return;
      }
      
      console.log(`Initiating WebRTC connection for ${transfer.transferId}`);
      const peerConnection = createPeerConnection();
      
      peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state changed to: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === 'failed') {
          console.log('Connection failed - falling back to server relay');
          fallbackToServerTransfer(transfer);
        }
      };
      
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state changed to: ${peerConnection.iceConnectionState}`);
        if (peerConnection.iceConnectionState === 'failed' || 
            peerConnection.iceConnectionState === 'disconnected') {
          console.log('ICE connection failed - falling back to server relay');
          fallbackToServerTransfer(transfer);
        }
      };
      
      // Add timeout fallback - if WebRTC doesn't connect within 5 seconds, use server relay
      setTimeout(() => {
        const currentTransfer = transfersRef.current[transfer.transferId];
        if (currentTransfer && currentTransfer.status === 'connecting') {
          console.log('WebRTC connection timeout - falling back to server relay');
          fallbackToServerTransfer(currentTransfer);
        }
      }, 5000);
      
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
