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

    // Send transfer offer
    sendMessage({
      type: 'transfer-offer',
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      senderId: deviceId,
      receiverId
    });

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
      const peerConnection = createPeerConnection();
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
          sendMessage({
            type: 'webrtc-ice-candidate',
            transferId: transfer.transferId,
            candidate: event.candidate
          });
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

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
      const peerConnection = createPeerConnection();
      updateTransfer(transfer.transferId, { 
        peerConnection, 
        status: 'connecting',
        chunks: [],
        receivedChunks: 0
      });

      peerConnection.ondatachannel = (event) => {
        const dataChannel = event.channel;
        updateTransfer(transfer.transferId, { dataChannel });
        setupDataChannel(dataChannel, transfer.transferId, false);
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
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
      if (transfer.peerConnection) {
        await transfer.peerConnection.addIceCandidate(candidate);
      }
    } catch (error) {
      console.error('Failed to handle ICE candidate:', error);
    }
  }, []);

  const setupDataChannel = useCallback((dataChannel: RTCDataChannel, transferId: string, isSender: boolean) => {
    dataChannel.onopen = () => {
      console.log('Data channel opened');
      updateTransfer(transferId, { status: 'connected' });
      
      if (isSender) {
        startFileTransfer(transferId);
      }
    };

    dataChannel.onmessage = (event) => {
      if (!isSender) {
        handleFileChunk(transferId, event.data);
      }
    };

    dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
      updateTransfer(transferId, { status: 'failed' });
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

  return {
    transfers,
    sendFile,
    acceptTransfer,
    rejectTransfer
  };
}
