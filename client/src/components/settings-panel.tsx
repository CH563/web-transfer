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
    <div className="bg-card pixel-border border-primary pixel-shadow p-6">
      <h2 className="text-lg text-accent uppercase tracking-wider mb-6 pixel-blink">SETTINGS</h2>
      
      <div className="space-y-6">
        {/* Device Name */}
        <div className="space-y-3">
          <Label htmlFor="device-name" className="text-xs text-primary uppercase tracking-wider pixel-font">
            DEVICE NAME
          </Label>
          <Input
            id="device-name"
            value={deviceName}
            onChange={(e) => onDeviceNameChange(e.target.value)}
            className="w-full pixel-border border-border bg-input text-foreground pixel-font text-xs uppercase tracking-wider"
          />
        </div>

        {/* Auto Accept */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-xs text-primary uppercase tracking-wider pixel-font">
              AUTO ACCEPT
            </Label>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              AUTO ACCEPT FROM TRUSTED DEVICES
            </p>
          </div>
          <div className="pixel-border border-border bg-muted p-1">
            <Switch
              checked={autoAccept}
              onCheckedChange={handleAutoAcceptChange}
              className="data-[state=checked]:bg-success data-[state=unchecked]:bg-destructive"
            />
          </div>
        </div>

        {/* Sound Notifications */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-xs text-primary uppercase tracking-wider pixel-font">
              SOUND ALERTS
            </Label>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              PLAY SOUND FOR INCOMING FILES
            </p>
          </div>
          <div className="pixel-border border-border bg-muted p-1">
            <Switch
              checked={soundNotifications}
              onCheckedChange={handleSoundNotificationsChange}
              className="data-[state=checked]:bg-success data-[state=unchecked]:bg-destructive"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
