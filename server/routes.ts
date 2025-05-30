import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import archiver from "archiver";
import { storage } from "./storage";
import { wsMessageSchema, type WSMessage } from "@shared/schema";
import { z } from "zod";

interface WebSocketClient extends WebSocket {
  deviceId?: string;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // WebSocket server for signaling
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws'
  });

  const connectedClients = new Map<string, WebSocketClient>();

  wss.on('connection', (ws: WebSocketClient) => {
    console.log('WebSocket client connected');

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        const validatedMessage = wsMessageSchema.parse(message);
        
        await handleWebSocketMessage(ws, validatedMessage);
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });

    ws.on('close', async () => {
      if (ws.deviceId) {
        await storage.setDeviceOffline(ws.deviceId);
        connectedClients.delete(ws.deviceId);
        broadcastDeviceList();
      }
    });
  });

  async function handleWebSocketMessage(ws: WebSocketClient, message: WSMessage) {
    switch (message.type) {
      case 'device-register': {
        try {
          // Check if device already exists
          let device = await storage.getDevice(message.device.deviceId);
          if (!device) {
            device = await storage.createDevice(message.device);
          } else {
            device = await storage.updateDevice(message.device.deviceId, {
              name: message.device.name,
              type: message.device.type,
              status: 'available'
            });
          }

          // Close any existing connection for this device
          const existingConnection = connectedClients.get(message.device.deviceId);
          if (existingConnection && existingConnection !== ws) {
            console.log(`Closing existing connection for device ${message.device.deviceId}`);
            existingConnection.close();
          }
          
          ws.deviceId = message.device.deviceId;
          connectedClients.set(message.device.deviceId, ws);

          // Send current device list to new client
          const devices = await storage.getAvailableDevices(ws.deviceId);
          ws.send(JSON.stringify({
            type: 'device-list',
            devices
          }));

          // Broadcast updated device list to all clients
          broadcastDeviceList();
        } catch (error) {
          console.error('Device registration error:', error);
        }
        break;
      }

      case 'device-update': {
        if (ws.deviceId) {
          await storage.updateDevice(ws.deviceId, message.updates);
          broadcastDeviceList();
        }
        break;
      }

      case 'transfer-offer': {
        try {
          const transfer = await storage.createTransfer({
            transferId: message.transferId,
            fileName: message.fileName,
            fileSize: message.fileSize,
            fileType: message.fileType,
            senderId: message.senderId,
            receiverId: message.receiverId,
            status: 'pending',
            progress: 0
          });

          // Forward to recipient
          const recipientWs = connectedClients.get(message.receiverId);
          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify(message));
          }
        } catch (error) {
          console.error('Transfer offer error:', error);
        }
        break;
      }

      case 'transfer-answer': {
        const transfer = await storage.updateTransfer(message.transferId, {
          status: message.accepted ? 'accepted' : 'rejected'
        });

        // Track accepted transfers for download authorization
        if (message.accepted) {
          acceptedTransfers.add(message.transferId);
          console.log(`Transfer ${message.transferId} accepted by user`);
        } else {
          console.log(`Transfer ${message.transferId} rejected by user`);
        }

        if (transfer) {
          // Forward to sender
          const senderWs = connectedClients.get(transfer.senderId);
          if (senderWs && senderWs.readyState === WebSocket.OPEN) {
            senderWs.send(JSON.stringify(message));
          }
        }
        break;
      }

      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice-candidate': {
        const transfer = await storage.getTransfer(message.transferId);
        if (transfer) {
          const targetDeviceId = message.type === 'webrtc-offer' ? transfer.receiverId : transfer.senderId;
          const targetWs = connectedClients.get(targetDeviceId);
          
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify(message));
          }
        }
        break;
      }

      case 'transfer-progress': {
        await storage.updateTransfer(message.transferId, {
          progress: message.progress,
          status: message.progress >= 100 ? 'completed' : 'transferring'
        });

        // Broadcast to both sender and receiver
        const transfer = await storage.getTransfer(message.transferId);
        if (transfer) {
          [transfer.senderId, transfer.receiverId].forEach(deviceId => {
            const clientWs = connectedClients.get(deviceId);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify(message));
            }
          });
        }
        break;
      }

      case 'transfer-complete': {
        await storage.updateTransfer(message.transferId, {
          status: 'completed',
          progress: 100
        });

        const transfer = await storage.getTransfer(message.transferId);
        if (transfer) {
          [transfer.senderId, transfer.receiverId].forEach(deviceId => {
            const clientWs = connectedClients.get(deviceId);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify(message));
            }
          });
        }
        break;
      }

      case 'transfer-error': {
        await storage.updateTransfer(message.transferId, {
          status: 'failed'
        });

        const transfer = await storage.getTransfer(message.transferId);
        if (transfer) {
          [transfer.senderId, transfer.receiverId].forEach(deviceId => {
            const clientWs = connectedClients.get(deviceId);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify(message));
            }
          });
        }
        break;
      }

      default: {
        // 处理心跳和其他未定义的消息类型
        if (message.type === 'ping') {
          // 心跳响应：维持WebSocket连接活跃状态，确保实时通信
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: 'pong', 
              timestamp: Date.now(),
              originalTimestamp: message.timestamp || Date.now()
            }));
          }
        } else {
          console.log('Unknown message type:', message.type);
        }
        break;
      }
    }
  }

  async function broadcastDeviceList() {
    const devices = await storage.getAvailableDevices();
    const message = JSON.stringify({
      type: 'device-list',
      devices
    });

    connectedClients.forEach((ws, deviceId) => {
      if (ws.readyState === WebSocket.OPEN) {
        const filteredDevices = devices.filter(d => d.deviceId !== deviceId);
        ws.send(JSON.stringify({
          type: 'device-list',
          devices: filteredDevices
        }));
      }
    });
  }

  // File transfer storage for fallback
  const fileTransfers = new Map<string, { file: Buffer; fileName: string; fileType: string; relativePath: string; uploadedAt: Date }>();

  // REST API endpoints
  app.get('/api/devices', async (req, res) => {
    try {
      const devices = await storage.getAvailableDevices();
      res.json(devices);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch devices' });
    }
  });

  app.get('/api/transfers/:deviceId', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const active = await storage.getActiveTransfers(deviceId);
      const history = await storage.getTransferHistory(deviceId);
      
      res.json({ active, history });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch transfers' });
    }
  });

  // Track processed uploads to prevent duplicates
  const processedUploads = new Set<string>();
  
  // Track notified transfers to prevent duplicate notifications
  const notifiedTransfers = new Set<string>();
  
  // Track accepted transfers to ensure downloads only happen after user consent
  const acceptedTransfers = new Set<string>();

  // 优化的文件上传端点：确保100%传输成功率
  app.post('/api/transfer/:transferId/upload', (req, res) => {
    const { transferId } = req.params;
    const retryCount = parseInt(req.headers['x-retry-count'] as string) || 0;
    const clientTimestamp = req.headers['x-client-timestamp'] as string;
    
    console.log(`Upload request for ${transferId} - attempt ${retryCount + 1}, client timestamp: ${clientTimestamp}`);
    
    // 防重复处理：检查是否已成功处理此传输
    if (processedUploads.has(transferId)) {
      console.log(`Transfer ${transferId} already processed successfully`);
      res.json({ success: true, message: 'Transfer already completed' });
      return;
    }
    
    // 请求超时保护：设置30秒超时以防止hang住
    const timeout = setTimeout(() => {
      console.error(`Upload timeout for ${transferId} after 30 seconds`);
      if (!res.headersSent) {
        res.status(408).json({ error: 'Upload timeout' });
      }
    }, 30000);
    
    const chunks: Buffer[] = [];
    let totalReceived = 0;
    
    req.on('data', (chunk) => {
      chunks.push(chunk);
      totalReceived += chunk.length;
      console.log(`Received ${chunk.length} bytes, total: ${totalReceived}`);
    });
    
    req.on('error', (error) => {
      console.error(`Upload error for ${transferId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Upload failed' });
      }
    });
    
    req.on('end', async () => {
      console.log(`Upload complete for ${transferId}, processing ${totalReceived} bytes`);
      try {
        const fileBuffer = Buffer.concat(chunks);
        const fileName = decodeURIComponent(req.headers['x-filename'] as string || 'unknown');
        const fileType = req.headers['content-type'] || 'application/octet-stream';
        const relativePath = req.headers['x-relative-path'] as string ? decodeURIComponent(req.headers['x-relative-path'] as string) : fileName;
        
        // Mark as processed to prevent duplicates
        processedUploads.add(transferId);
        
        fileTransfers.set(transferId, {
          file: fileBuffer,
          fileName,
          fileType,
          relativePath,
          uploadedAt: new Date()
        });
        
        // Update transfer status
        await storage.updateTransfer(transferId, { status: 'completed', progress: 100 });
        
        // Notify receiver only once - prevent duplicate notifications
        if (!notifiedTransfers.has(transferId)) {
          notifiedTransfers.add(transferId);
          
          const transfer = await storage.getTransfer(transferId);
          if (transfer) {
            // Send notification to only one active connection of the receiver
            const message = JSON.stringify({
              type: 'transfer-complete',
              transferId
            });
            
            let notified = false;
            // Find the first active connection for the receiver
            const connections = Array.from(connectedClients.entries());
            for (const [deviceId, ws] of connections) {
              if (deviceId === transfer.receiverId && ws.readyState === WebSocket.OPEN && !notified) {
                ws.send(message);
                notified = true;
                console.log(`Notified receiver ${deviceId} about completed transfer ${transferId}`);
                break; // Only notify once
              }
            }
            
            if (!notified) {
              console.log(`No active connection found for receiver ${transfer.receiverId}`);
            }
          }
          
          // Clean up notification tracking after delay
          setTimeout(() => {
            notifiedTransfers.delete(transferId);
          }, 30000);
        } else {
          console.log(`Transfer ${transferId} already notified, skipping`);
        }
        
        // Clean up processed uploads after delay to allow retries if needed
        setTimeout(() => {
          processedUploads.delete(transferId);
        }, 30000); // 30 seconds
        
        res.json({ success: true });
      } catch (error) {
        console.error('Upload failed:', error);
        processedUploads.delete(transferId); // Remove on error to allow retry
        res.status(500).json({ error: 'Upload failed' });
      }
    });
  });

  // Fallback file download endpoint
  app.get('/api/transfer/:transferId/download', async (req, res) => {
    try {
      const { transferId } = req.params;
      
      // Check if transfer was explicitly accepted by user
      if (!acceptedTransfers.has(transferId)) {
        console.log(`Download denied for ${transferId} - transfer not accepted by user`);
        return res.status(403).json({ error: 'Transfer not accepted by user' });
      }
      
      const fileData = fileTransfers.get(transferId);
      
      if (!fileData) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      console.log(`Authorized download for accepted transfer ${transferId}: ${fileData.fileName}`);
      
      res.set({
        'Content-Type': fileData.fileType,
        'Content-Disposition': `attachment; filename="${fileData.fileName}"`,
        'Content-Length': fileData.file.length.toString()
      });
      
      res.send(fileData.file);
      
      // Clean up after download
      setTimeout(() => {
        fileTransfers.delete(transferId);
        acceptedTransfers.delete(transferId);
      }, 60000); // Keep for 1 minute after download
      
    } catch (error) {
      console.error('Download failed:', error);
      res.status(500).json({ error: 'Download failed' });
    }
  });

  return httpServer;
}
