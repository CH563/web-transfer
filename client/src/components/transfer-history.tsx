import { CheckCircle, XCircle, Download, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Transfer, Device } from "@shared/schema";

interface TransferHistoryProps {
  transfers: Transfer[];
  currentDeviceId: string;
  availableDevices: Device[];
}

const formatTimeAgo = (date: Date): string => {
  const now = new Date();
  const dateObj = date instanceof Date ? date : new Date(date);
  
  if (isNaN(dateObj.getTime())) {
    return 'Unknown time';
  }
  
  const diffInMinutes = Math.floor((now.getTime() - dateObj.getTime()) / (1000 * 60));
  
  if (diffInMinutes < 1) return 'Just now';
  if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
};

export default function TransferHistory({ 
  transfers, 
  currentDeviceId, 
  availableDevices 
}: TransferHistoryProps) {
  if (transfers.length === 0) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Recent Transfers</h2>
        <div className="text-center py-4 text-muted-foreground">
          <p className="text-sm">No transfer history</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Recent Transfers</h2>
      
      <div className="space-y-3">
        {transfers.map((transfer) => {
          const isSending = transfer.senderId === currentDeviceId;
          const isCompleted = transfer.status === 'completed';
          const isFailed = transfer.status === 'failed' || transfer.status === 'rejected';
          
          const otherDeviceId = isSending ? transfer.receiverId : transfer.senderId;
          const otherDevice = availableDevices.find(d => d.deviceId === otherDeviceId);
          const otherDeviceName = otherDevice?.name || 'Unknown Device';
          
          const getStatusIcon = () => {
            if (isCompleted) return CheckCircle;
            return XCircle;
          };
          
          const getStatusBg = () => {
            if (isCompleted) return 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400';
            return 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400';
          };
          
          const StatusIcon = getStatusIcon();
          const statusBgClass = getStatusBg();
          
          return (
            <div key={transfer.id} className="flex items-center space-x-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${statusBgClass}`}>
                <StatusIcon size={14} />
              </div>
              
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-foreground truncate">
                  {transfer.fileName}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {isSending ? (
                    <>
                      <Upload className="inline mr-1" size={10} />
                      Sent to
                    </>
                  ) : (
                    <>
                      <Download className="inline mr-1" size={10} />
                      Received from
                    </>
                  )}{' '}
                  <span className="font-medium">{otherDeviceName}</span> • {' '}
                  {formatTimeAgo(transfer.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      
      <Button 
        variant="ghost" 
        className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground" 
      >
        View all transfers
      </Button>
    </Card>
  );
}
