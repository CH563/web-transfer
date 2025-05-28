import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";

interface SettingsPanelProps {
  deviceName: string;
  onDeviceNameChange: (name: string) => void;
}

export default function SettingsPanel({ deviceName, onDeviceNameChange }: SettingsPanelProps) {
  const [autoAccept, setAutoAccept] = useState(() => {
    const saved = localStorage.getItem('autoAccept');
    return saved ? JSON.parse(saved) : false;
  });
  
  const [soundNotifications, setSoundNotifications] = useState(() => {
    const saved = localStorage.getItem('soundNotifications');
    return saved ? JSON.parse(saved) : true;
  });

  const handleAutoAcceptChange = (checked: boolean) => {
    setAutoAccept(checked);
    localStorage.setItem('autoAccept', JSON.stringify(checked));
  };

  const handleSoundNotificationsChange = (checked: boolean) => {
    setSoundNotifications(checked);
    localStorage.setItem('soundNotifications', JSON.stringify(checked));
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Settings</h2>
      
      <div className="space-y-4">
        {/* Device Name */}
        <div className="space-y-2">
          <Label htmlFor="device-name" className="text-sm font-medium text-foreground">
            Device Name
          </Label>
          <Input
            id="device-name"
            value={deviceName}
            onChange={(e) => onDeviceNameChange(e.target.value)}
            className="w-full"
          />
        </div>

        {/* Auto Accept */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium text-foreground">
              Auto Accept
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically accept files from trusted devices
            </p>
          </div>
          <Switch
            checked={autoAccept}
            onCheckedChange={handleAutoAcceptChange}
          />
        </div>

        {/* Sound Notifications */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium text-foreground">
              Sound Notifications
            </Label>
            <p className="text-xs text-muted-foreground">
              Play sound for incoming files
            </p>
          </div>
          <Switch
            checked={soundNotifications}
            onCheckedChange={handleSoundNotificationsChange}
          />
        </div>
      </div>
    </Card>
  );
}
