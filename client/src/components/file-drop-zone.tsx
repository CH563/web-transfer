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
    <div 
      className={`bg-card pixel-border border-primary pixel-shadow p-8 text-center cursor-pointer transition-all duration-200 ${
        isDragOver ? 'drag-over' : 'hover:bg-primary/5'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleFileSelect}
    >
      <div className="space-y-6">
        <div className="w-20 h-20 mx-auto bg-primary pixel-border border-card flex items-center justify-center pixel-shadow">
          <CloudUpload className="text-primary-foreground" size={40} />
        </div>
        
        <div>
          <h3 className="text-lg text-accent uppercase tracking-wider mb-2 pixel-font">
            DROP FILES HERE
          </h3>
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            OR CLICK TO SELECT FILES/FOLDERS
          </p>
        </div>

        {availableDevices.length > 0 && (
          <div className="max-w-xs mx-auto">
            <div className="bg-input pixel-border border-border">
              <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                <SelectTrigger className="pixel-border border-0 bg-transparent text-xs uppercase tracking-wider">
                  <SelectValue placeholder="SELECT TARGET DEVICE" />
                </SelectTrigger>
                <SelectContent className="bg-card pixel-border border-primary">
                  {availableDevices.map((device) => (
                    <SelectItem 
                      key={device.deviceId} 
                      value={device.deviceId}
                      className="text-xs uppercase tracking-wider hover:bg-primary/20"
                    >
                      {device.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex gap-4 justify-center">
          <button 
            className="bg-secondary text-secondary-foreground pixel-button px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-50"
            disabled={!selectedDevice}
            onClick={(e) => {
              e.stopPropagation();
              handleFileSelect();
            }}
          >
            <Plus className="inline mr-2" size={12} />
            FILES
          </button>
          
          <button 
            className="bg-accent text-accent-foreground pixel-button px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-50"
            disabled={!selectedDevice}
            onClick={(e) => {
              e.stopPropagation();
              handleFolderSelect();
            }}
          >
            <Folder className="inline mr-2" size={12} />
            FOLDER
          </button>
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
        {...({ webkitdirectory: "" } as any)}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
    </div>
  );
}
