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

    ws.onclose = (event) => {
      console.log(`WebSocket disconnected - Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
      setIsConnected(false);
      setWsClient(null);
      onConnectionStatusChange('disconnected');
      
      // 智能重连机制：根据断开原因决定重连策略
      const shouldReconnect = event.code !== 1000 && // 1000 = 正常关闭
                             event.code !== 1001 && // 1001 = 页面离开
                             reconnectAttempts.current < maxReconnectAttempts;
      
      if (shouldReconnect) {
        reconnectAttempts.current++;
        // 指数退避算法，避免服务器过载，最大延迟30秒
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        
        console.log(`WebSocket reconnection scheduled in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`WebSocket reconnection attempt ${reconnectAttempts.current} - ensuring continuous connectivity`);
          connect();
        }, delay);
      } else if (reconnectAttempts.current >= maxReconnectAttempts) {
        console.error('WebSocket max reconnection attempts reached - connection permanently failed');
        // 连接彻底失败时，确保用户知道系统已切换到服务器中继模式
        onConnectionStatusChange('disconnected');
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket connection error:', error);
      // WebSocket错误通常表示网络问题，但不影响传输成功率
      // 系统会自动切换到服务器中继确保传输完成
    };

    // 心跳检测：定期发送ping消息检测连接状态
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (error) {
          console.warn('Failed to send heartbeat ping:', error);
          clearInterval(heartbeatInterval);
        }
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000); // 每30秒发送一次心跳

    // 清理函数：确保间隔器被正确清理
    ws.addEventListener('close', () => {
      clearInterval(heartbeatInterval);
    });
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
        // Handle transfer completion - only dispatch to WebRTC handler, don't auto-download here
        // The download will be handled by the WebRTC hook to prevent duplicates
        window.dispatchEvent(new CustomEvent('webrtc-message', { detail: message }));
        break;
      
      case 'pong':
        // 心跳响应：确认连接活跃，记录延迟信息
        const latency = Date.now() - (message.originalTimestamp || 0);
        console.log(`WebSocket heartbeat: ${latency}ms latency`);
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
