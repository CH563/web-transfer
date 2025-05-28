import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
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

  return httpServer;
}
