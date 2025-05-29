import { useState, useRef } from "react";
import { CloudUpload, Plus, Folder } from "lucide-react";
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
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  // Function to recursively process folder entries
  const processEntry = (entry: FileSystemEntry): Promise<File[]> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file((file) => {
          // Preserve folder structure by setting webkitRelativePath
          Object.defineProperty(file, 'webkitRelativePath', {
            value: entry.fullPath.substring(1), // Remove leading slash
            writable: false
          });
          resolve([file]);
        });
      } else if (entry.isDirectory) {
        const dirReader = (entry as FileSystemDirectoryEntry).createReader();
        const allFiles: File[] = [];
        
        const readEntries = () => {
          dirReader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(allFiles);
            } else {
              for (const childEntry of entries) {
                const childFiles = await processEntry(childEntry);
                allFiles.push(...childFiles);
              }
              readEntries(); // Continue reading if there are more entries
            }
          });
        };
        readEntries();
      } else {
        resolve([]);
      }
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];

    // Handle both files and folders
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          const entryFiles = await processEntry(entry);
          files.push(...entryFiles);
        }
      }
    }

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

  const handleFolderSelect = () => {
    if (folderInputRef.current) {
      folderInputRef.current.click();
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
          <h3 className="text-lg font-semibold text-foreground">Drop files or folders here to share</h3>
          <p className="text-muted-foreground">or click to select files/folders from your device</p>
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

        <div className="flex gap-2 justify-center">
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
          
          <Button 
            variant="outline"
            className="inline-flex items-center"
            disabled={!selectedDevice}
            onClick={(e) => {
              e.stopPropagation();
              handleFolderSelect();
            }}
          >
            <Folder className="mr-2" size={16} />
            Select Folder
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
    </Card>
  );
}
