import { useState, useEffect, useRef, useCallback } from "react";
import type { Device, WSMessage } from "@shared/schema";

// Global WebSocket instance to prevent multiple connections
let globalWsClient: WebSocket | null = null;
let globalConnectionState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
let isConnecting = false;

interface UseWebSocketProps {
  onDeviceList: (devices: Device[]) => void;
  onTransferOffer: (offer: any) => void;
  onConnectionStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
  onTransferUpdate: (transfer: any) => void;
}

export function useWebSocket({
  onDeviceList,
  onTransferOffer,
  onConnectionStatusChange,
  onTransferUpdate
}: UseWebSocketProps) {
  const [wsClient, setWsClient] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const messageQueue = useRef<WSMessage[]>([]);

  const connect = useCallback(() => {
    // Check for existing global connection first
    if (globalWsClient?.readyState === WebSocket.OPEN) {
      setWsClient(globalWsClient);
      setIsConnected(true);
      onConnectionStatusChange('connected');
      return;
    }

    if (isConnecting || globalWsClient?.readyState === WebSocket.CONNECTING) {
      return;
    }

    isConnecting = true;
    globalConnectionState = 'connecting';
    onConnectionStatusChange('connecting');
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    globalWsClient = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      isConnecting = false;
      globalConnectionState = 'connected';
      setIsConnected(true);
      setWsClient(ws);
      onConnectionStatusChange('connected');
      reconnectAttempts.current = 0;
      
      // Send queued messages
      while (messageQueue.current.length > 0) {
        const message = messageQueue.current.shift();
        if (message && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setWsClient(null);
      onConnectionStatusChange('disconnected');
      
      // Attempt to reconnect
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`Reconnection attempt ${reconnectAttempts.current}`);
          connect();
        }, delay);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [wsClient, onConnectionStatusChange]);

  const handleMessage = (message: any) => {
    switch (message.type) {
      case 'device-list':
        onDeviceList(message.devices);
        break;
      
      case 'transfer-offer':
        onTransferOffer(message);
        break;
      
      case 'transfer-answer':
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice-candidate':
      case 'transfer-progress':
      case 'transfer-error':
        // These are handled by the WebRTC hook
        window.dispatchEvent(new CustomEvent('webrtc-message', { detail: message }));
        break;
        
      case 'transfer-complete':
        // Handle transfer completion
        window.dispatchEvent(new CustomEvent('webrtc-message', { detail: message }));
        
        // Auto-download completed file
        if (message.transferId) {
          setTimeout(() => {
            const downloadUrl = `/api/transfer/${message.transferId}/download`;
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log(`Auto-downloading completed transfer: ${message.transferId}`);
          }, 1000);
        }
        break;
      
      default:
        console.log('Unknown message type:', message.type);
    }
  };

  const sendMessage = useCallback((message: WSMessage) => {
    if (wsClient?.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, queuing message:', message.type);
      messageQueue.current.push(message);
      connect();
    }
  }, [wsClient, connect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsClient) {
        wsClient.close();
      }
    };
  }, []);

  return {
    wsClient,
    isConnected,
    sendMessage,
    reconnect: connect
  };
}
