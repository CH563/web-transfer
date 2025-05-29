import { FileText, FileImage, File, X, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Transfer, Device } from "@shared/schema";

interface TransferItemProps {
  transfer: Transfer;
  currentDeviceId: string;
  availableDevices: Device[];
}

const getFileIcon = (fileType: string) => {
  if (fileType.startsWith('image/')) return FileImage;
  if (fileType.includes('pdf') || fileType.includes('document')) return FileText;
  return File;
};

const getFileIconBg = (fileType: string) => {
  if (fileType.startsWith('image/')) return 'bg-green-100 text-green-600';
  if (fileType.includes('pdf') || fileType.includes('document')) return 'bg-blue-100 text-primary';
  return 'bg-gray-100 text-gray-600';
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function TransferItem({ transfer, currentDeviceId, availableDevices }: TransferItemProps) {
  const FileIcon = getFileIcon(transfer.fileType);
  const iconBgClass = getFileIconBg(transfer.fileType);
  
  const isCompleted = transfer.status === 'completed';
  const isFailed = transfer.status === 'failed';
  const isSending = transfer.senderId === currentDeviceId;
  
  const otherDeviceId = isSending ? transfer.receiverId : transfer.senderId;
  const otherDevice = availableDevices.find(d => d.deviceId === otherDeviceId);
  const otherDeviceName = otherDevice?.name || 'Unknown Device';

  const getCardBgClass = () => {
    if (isCompleted) return 'bg-green-50 dark:bg-green-950/20';
    if (isFailed) return 'bg-red-50 dark:bg-red-950/20';
    return 'bg-muted/50';
  };

  const getProgressColor = () => {
    if (isCompleted) return 'bg-green-500';
    if (isFailed) return 'bg-red-500';
    return '';
  };

  return (
    <div className={`flex items-center space-x-4 p-4 rounded-lg ${getCardBgClass()}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBgClass}`}>
        <FileIcon size={20} />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-medium text-foreground truncate">
            {transfer.fileName}
          </h4>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(transfer.fileSize)}
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          {!isCompleted && !isFailed && (
            <>
              <div className="flex-1 relative">
                <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                  <div 
                    className={`h-2 rounded-full transition-all duration-500 ease-out ${
                      transfer.status === 'transferring' && transfer.progress > 0
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 animate-pulse'
                        : 'bg-primary'
                    }`}
                    style={{ width: `${transfer.progress}%` }}
                  />
                  {transfer.status === 'transferring' && transfer.progress > 0 && (
                    <div 
                      className="absolute top-0 h-2 w-8 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-slide-right"
                      style={{ 
                        left: `${Math.max(0, transfer.progress - 20)}%`,
                        animation: 'slide-right 2s infinite'
                      }}
                    />
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground font-medium">
                {transfer.progress}%
              </span>
            </>
          )}
          
          {isCompleted && (
            <div className="flex items-center space-x-2 flex-1">
              <div className="flex-1 bg-green-200 dark:bg-green-800 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full w-full" />
              </div>
              <CheckCircle className="text-green-500" size={16} />
            </div>
          )}
          
          {isFailed && (
            <div className="flex-1 bg-red-200 dark:bg-red-800 rounded-full h-2">
              <div className="bg-red-500 h-2 rounded-full w-full" />
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-muted-foreground">
            {isCompleted && (
              <span className="text-green-600 dark:text-green-400 font-medium">Completed</span>
            )}
            {isFailed && (
              <span className="text-red-600 dark:text-red-400 font-medium">Failed</span>
            )}
            {!isCompleted && !isFailed && (
              <span>{isSending ? 'Sending to' : 'Receiving from'}</span>
            )}
            {' '}
            <span className="font-medium">{otherDeviceName}</span>
          </p>
          
          {transfer.status === 'transferring' && !isCompleted && !isFailed && (
            <div className="flex items-center space-x-1">
              <div className="w-1 h-1 rounded-full bg-blue-500 animate-bounce" />
              <div className="w-1 h-1 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-1 h-1 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
          )}
        </div>
      </div>
      
      {!isCompleted && !isFailed && (
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          <X size={16} />
        </Button>
      )}
    </div>
  );
}
