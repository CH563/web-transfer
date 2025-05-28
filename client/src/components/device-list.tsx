import { Smartphone, Tablet, Laptop, RefreshCw, Wifi } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Device } from "@shared/schema";

interface DeviceListProps {
  devices: Device[];
  onRefresh: () => void;
}

const getDeviceIcon = (type: string) => {
  switch (type) {
    case 'mobile': return Smartphone;
    case 'tablet': return Tablet;
    default: return Laptop;
  }
};

const getDeviceIconBg = (type: string) => {
  switch (type) {
    case 'mobile': return 'bg-blue-100 text-primary';
    case 'tablet': return 'bg-purple-100 text-purple-600';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'available': return 'bg-green-500';
    case 'busy': return 'bg-yellow-500';
    default: return 'bg-red-500';
  }
};

export default function DeviceList({ devices, onRefresh }: DeviceListProps) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Available Devices</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw size={16} />
        </Button>
      </div>

      {devices.length > 0 ? (
        <div className="space-y-3">
          {devices.map((device) => {
            const DeviceIcon = getDeviceIcon(device.type);
            const iconBgClass = getDeviceIconBg(device.type);
            const statusColor = getStatusColor(device.status);
            
            return (
              <div
                key={device.deviceId}
                className="flex items-center space-x-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBgClass}`}>
                  <DeviceIcon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-foreground truncate">
                    {device.name}
                  </h4>
                  <p className="text-xs text-muted-foreground capitalize">
                    {device.status}
                  </p>
                </div>
                <div className={`w-2 h-2 rounded-full ${statusColor}`} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <Wifi className="mx-auto mb-2 opacity-50" size={32} />
          <p className="text-sm">No devices found</p>
          <p className="text-xs">Make sure devices are on the same network</p>
        </div>
      )}
    </Card>
  );
}
