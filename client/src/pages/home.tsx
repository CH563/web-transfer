import { useState, useEffect, useRef } from "react";
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
import { useToast } from "@/hooks/use-toast";
import type { Device, Transfer } from "@shared/schema";

export default function Home() {
  const { toast } = useToast();
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

  const transferLock = useRef(false);
  
  const handleFileDrop = async (files: File[], targetDevice: Device) => {
    if (transferLock.current) {
      console.log('Transfer already in progress, ignoring duplicate request');
      return;
    }
    
    transferLock.current = true;
    
    try {
      // Check if this is a folder transfer (files have webkitRelativePath)
      const hasFolder = files.some(file => file.webkitRelativePath);
      
      if (hasFolder) {
        console.log(`Sending folder with ${files.length} files to device: ${targetDevice.name}`);
        
        // Group files by folder structure and send them
        for (const file of files) {
          const relativePath = file.webkitRelativePath || file.name;
          console.log(`Sending file: ${relativePath}`);
          
          // Create transfer directly through server API for folder files
          const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substring(2)}`;
          
          const response = await fetch(`/api/transfer/${transferId}/upload`, {
            method: 'POST',
            headers: {
              'X-Filename': file.name,
              'X-Relative-Path': relativePath,
              'Content-Type': file.type || 'application/octet-stream',
              'X-Sender-Id': deviceId,
              'X-Receiver-Id': targetDevice.deviceId
            },
            body: file
          });
          
          if (!response.ok) {
            throw new Error(`Upload failed for ${relativePath}`);
          }
        }
        
        // Notify receiving device about folder transfer
        sendMessage({
          type: 'transfer-complete',
          transferId: `folder_${Date.now()}`
        });
        
        toast({
          title: "Folder Sent",
          description: `Folder with ${files.length} files sent to ${targetDevice.name}`
        });
      } else {
        // Single file transfers
        for (const file of files) {
          console.log(`Sending file: ${file.name} to device: ${targetDevice.name}`);
          await sendFile(file, targetDevice.deviceId);
        }
      }
    } catch (error) {
      console.error('Failed to send files:', error);
      toast({
        title: "Transfer Failed",
        description: "Failed to send files",
        variant: "destructive"
      });
    } finally {
      // Release lock after a short delay to prevent rapid duplicate triggers
      setTimeout(() => {
        transferLock.current = false;
      }, 1000);
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
      // Create a transfer record for the receiver before accepting
      const receiverTransfer = {
        transferId: incomingTransfer.transferId,
        fileName: incomingTransfer.fileName,
        fileSize: incomingTransfer.fileSize,
        fileType: incomingTransfer.fileType,
        senderId: incomingTransfer.senderId,
        receiverId: deviceId,
        status: 'accepted',
        progress: 0
      };
      
      setActiveTransfers(prev => [...prev, receiverTransfer as any]);
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

  // Use active transfers from server
  const allActiveTransfers = activeTransfers || [];

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

      {/* Footer with Security & Privacy Info */}
      <footer className="bg-card border-t border-border mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">
                Secure Peer-to-Peer File Transfer
              </h2>
              <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
                End-to-end encrypted file sharing based on WebRTC technology, no cloud storage required, protecting your privacy and security
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
              <div className="space-y-3">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center mx-auto">
                  <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center">
                    <div className="w-3 h-3 bg-white rounded-full"></div>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-foreground">End-to-End Encryption</h3>
                <p className="text-sm text-muted-foreground">
                  All file transfers are encrypted end-to-end via WebRTC, ensuring absolute security during data transmission
                </p>
              </div>

              <div className="space-y-3">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mx-auto">
                  <div className="w-6 h-6 border-2 border-blue-600 rounded-full relative">
                    <div className="absolute inset-1 bg-blue-600 rounded-full"></div>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-foreground">No Server Storage</h3>
                <p className="text-sm text-muted-foreground">
                  Files are transferred directly between devices without any server storage, completely protecting your privacy
                </p>
              </div>

              <div className="space-y-3">
                <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mx-auto">
                  <div className="w-6 h-6 relative">
                    <div className="absolute inset-0 border-2 border-purple-600 rounded-full"></div>
                    <div className="absolute inset-2 border-2 border-purple-600 rounded-full"></div>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-foreground">Real-time Transfer</h3>
                <p className="text-sm text-muted-foreground">
                  P2P connections based on WebRTC technology provide the fastest file transfer speeds and real-time progress feedback
                </p>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-border">
              <div className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0">
                <p className="text-sm text-muted-foreground">
                  Compatible with all modern browsers | No software installation required | Completely open source and free
                </p>
                <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                  <span>WebRTC</span>
                  <span>•</span>
                  <span>P2P</span>
                  <span>•</span>
                  <span>End-to-End Encrypted</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
