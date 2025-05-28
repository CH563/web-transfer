import { useState, useRef } from "react";
import { CloudUpload, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Device } from "@shared/schema";

interface FileDropZoneProps {
  onFileDrop: (files: File[], targetDevice: Device) => void;
  availableDevices: Device[];
}

export default function FileDropZone({ onFileDrop, availableDevices }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && selectedDevice) {
      const device = availableDevices.find(d => d.deviceId === selectedDevice);
      if (device) {
        onFileDrop(files, device);
      }
    }
  };

  const handleFileSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && selectedDevice) {
      const device = availableDevices.find(d => d.deviceId === selectedDevice);
      if (device) {
        onFileDrop(files, device);
      }
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card 
      className={`p-8 text-center border-2 border-dashed transition-all duration-300 hover:border-primary cursor-pointer ${
        isDragOver ? 'drag-over' : 'border-muted-foreground/25'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleFileSelect}
    >
      <div className="space-y-4">
        <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center">
          <CloudUpload className="text-2xl text-muted-foreground" size={32} />
        </div>
        
        <div>
          <h3 className="text-lg font-semibold text-foreground">Drop files here to share</h3>
          <p className="text-muted-foreground">or click to select files from your device</p>
        </div>

        {availableDevices.length > 0 && (
          <div className="max-w-xs mx-auto">
            <Select value={selectedDevice} onValueChange={setSelectedDevice}>
              <SelectTrigger>
                <SelectValue placeholder="Select target device" />
              </SelectTrigger>
              <SelectContent>
                {availableDevices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button 
          className="inline-flex items-center"
          disabled={!selectedDevice}
          onClick={(e) => {
            e.stopPropagation();
            handleFileSelect();
          }}
        >
          <Plus className="mr-2" size={16} />
          Select Files
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
    </Card>
  );
}
