import { useState, useEffect } from "react";
import { Share, Laptop, Cog } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FileDropZone from "@/components/file-drop-zone";
import DeviceList from "@/components/device-list";
import TransferItem from "@/components/transfer-item";
import TransferHistory from "@/components/transfer-history";
import SettingsPanel from "@/components/settings-panel";
import IncomingTransfer from "@/components/incoming-transfer";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebRTC } from "@/hooks/use-webrtc";
import type { Device, Transfer } from "@shared/schema";

export default function Home() {
  const [deviceName, setDeviceName] = useState(() => {
    const saved = localStorage.getItem('deviceName');
    return saved || `${navigator.platform} Device`;
  });
  
  const [deviceId] = useState(() => {
    const saved = localStorage.getItem('deviceId');
    if (saved) return saved;
    const newId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('deviceId', newId);
    return newId;
  });

  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
  const [transferHistory, setTransferHistory] = useState<Transfer[]>([]);
  const [incomingTransfer, setIncomingTransfer] = useState<any>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const { wsClient, sendMessage } = useWebSocket({
    onDeviceList: setAvailableDevices,
    onTransferOffer: setIncomingTransfer,
    onConnectionStatusChange: setConnectionStatus,
    onTransferUpdate: (transfer) => {
      setActiveTransfers(prev => prev.map(t => 
        t.transferId === transfer.transferId ? { ...t, ...transfer } : t
      ));
    }
  });

  const { 
    sendFile, 
    acceptTransfer, 
    rejectTransfer,
    transfers: webrtcTransfers
  } = useWebRTC({
    deviceId,
    sendMessage,
    onTransferComplete: (transferId) => {
      setActiveTransfers(prev => prev.filter(t => t.transferId !== transferId));
      // Refresh transfer history
      fetchTransfers();
    }
  });

  const fetchTransfers = async () => {
    try {
      const response = await fetch(`/api/transfers/${deviceId}`);
      if (response.ok) {
        const { active, history } = await response.json();
        setActiveTransfers(active);
        setTransferHistory(history);
      }
    } catch (error) {
      console.error('Failed to fetch transfers:', error);
    }
  };

  useEffect(() => {
    if (wsClient && connectionStatus === 'connected') {
      // Register device
      sendMessage({
        type: 'device-register',
        device: {
          deviceId,
          name: deviceName,
          type: getDeviceType(),
          status: 'available'
        }
      });

      fetchTransfers();
    }
  }, [wsClient, connectionStatus, deviceId, deviceName]);

  const getDeviceType = (): string => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (/iphone|android/.test(userAgent)) return 'mobile';
    if (/ipad|tablet/.test(userAgent)) return 'tablet';
    return 'laptop';
  };

  const handleFileDrop = async (files: File[], targetDevice: Device) => {
    for (const file of files) {
      try {
        await sendFile(file, targetDevice.deviceId);
      } catch (error) {
        console.error('Failed to send file:', error);
      }
    }
  };

  const handleDeviceNameChange = (newName: string) => {
    setDeviceName(newName);
    localStorage.setItem('deviceName', newName);
    
    if (wsClient && connectionStatus === 'connected') {
      sendMessage({
        type: 'device-update',
        deviceId,
        updates: { name: newName }
      });
    }
  };

  const handleAcceptTransfer = () => {
    if (incomingTransfer) {
      acceptTransfer(incomingTransfer.transferId);
      setIncomingTransfer(null);
    }
  };

  const handleRejectTransfer = () => {
    if (incomingTransfer) {
      rejectTransfer(incomingTransfer.transferId);
      setIncomingTransfer(null);
    }
  };

  // Combine active transfers from both sources
  const allActiveTransfers = [
    ...activeTransfers,
    ...Object.values(webrtcTransfers).filter(t => 
      !activeTransfers.some(at => at.transferId === t.transferId)
    )
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card shadow-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Share className="text-primary-foreground" size={16} />
              </div>
              <h1 className="text-xl font-bold text-foreground">WebDrop</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Connection Status */}
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500 connection-pulse' :
                  connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-sm text-muted-foreground capitalize">
                  {connectionStatus}
                </span>
              </div>
              
              {/* Device Name */}
              <div className="flex items-center space-x-2">
                <Laptop className="text-muted-foreground" size={16} />
                <span className="text-sm font-medium text-foreground">{deviceName}</span>
              </div>
              
              {/* Settings */}
              <Button variant="ghost" size="sm">
                <Cog size={16} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Transfer Area */}
          <div className="lg:col-span-2 space-y-6">
            <FileDropZone 
              onFileDrop={handleFileDrop}
              availableDevices={availableDevices}
            />

            {/* Active Transfers */}
            {allActiveTransfers.length > 0 && (
              <Card className="p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">Active Transfers</h2>
                <div className="space-y-4">
                  {allActiveTransfers.map((transfer) => (
                    <TransferItem 
                      key={transfer.transferId} 
                      transfer={transfer}
                      currentDeviceId={deviceId}
                      availableDevices={availableDevices}
                    />
                  ))}
                </div>
              </Card>
            )}

            {/* Incoming Transfer Request */}
            {incomingTransfer && (
              <IncomingTransfer
                transfer={incomingTransfer}
                onAccept={handleAcceptTransfer}
                onReject={handleRejectTransfer}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <DeviceList 
              devices={availableDevices}
              onRefresh={() => {
                if (wsClient && connectionStatus === 'connected') {
                  sendMessage({
                    type: 'device-register',
                    device: {
                      deviceId,
                      name: deviceName,
                      type: getDeviceType(),
                      status: 'available'
                    }
                  });
                }
              }}
            />

            <TransferHistory 
              transfers={transferHistory}
              currentDeviceId={deviceId}
              availableDevices={availableDevices}
            />

            <SettingsPanel
              deviceName={deviceName}
              onDeviceNameChange={handleDeviceNameChange}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
