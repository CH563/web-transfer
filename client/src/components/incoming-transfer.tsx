import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface IncomingTransferProps {
  transfer: {
    transferId: string;
    fileName: string;
    fileSize: number;
    senderId: string;
    senderName?: string;
  };
  onAccept: () => void;
  onReject: () => void;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function IncomingTransfer({ transfer, onAccept, onReject }: IncomingTransferProps) {
  return (
    <Card className="p-6 border-l-4 border-l-yellow-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg flex items-center justify-center">
            <Download className="text-yellow-600 dark:text-yellow-400" size={24} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Incoming File</h3>
            <p className="text-muted-foreground">
              <span className="font-medium">
                {transfer.senderName || transfer.senderId}
              </span>{' '}
              wants to send <span className="font-medium">{transfer.fileName}</span>{' '}
              ({formatFileSize(transfer.fileSize)})
            </p>
          </div>
        </div>
        
        <div className="flex space-x-2">
          <Button variant="outline" onClick={onReject}>
            Decline
          </Button>
          <Button 
            onClick={onAccept}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            Accept
          </Button>
        </div>
      </div>
    </Card>
  );
}
