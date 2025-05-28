import { devices, transfers, type Device, type InsertDevice, type Transfer, type InsertTransfer } from "@shared/schema";

export interface IStorage {
  // Device management
  getDevice(deviceId: string): Promise<Device | undefined>;
  getDeviceByInternalId(id: number): Promise<Device | undefined>;
  createDevice(device: InsertDevice): Promise<Device>;
  updateDevice(deviceId: string, updates: Partial<Device>): Promise<Device | undefined>;
  getAvailableDevices(excludeDeviceId?: string): Promise<Device[]>;
  setDeviceOffline(deviceId: string): Promise<void>;

  // Transfer management
  getTransfer(transferId: string): Promise<Transfer | undefined>;
  createTransfer(transfer: InsertTransfer): Promise<Transfer>;
  updateTransfer(transferId: string, updates: Partial<Transfer>): Promise<Transfer | undefined>;
  getActiveTransfers(deviceId: string): Promise<Transfer[]>;
  getTransferHistory(deviceId: string, limit?: number): Promise<Transfer[]>;
}

export class MemStorage implements IStorage {
  private devices: Map<string, Device>;
  private transfers: Map<string, Transfer>;
  private deviceIdCounter: number;
  private transferIdCounter: number;

  constructor() {
    this.devices = new Map();
    this.transfers = new Map();
    this.deviceIdCounter = 1;
    this.transferIdCounter = 1;
  }

  async getDevice(deviceId: string): Promise<Device | undefined> {
    return this.devices.get(deviceId);
  }

  async getDeviceByInternalId(id: number): Promise<Device | undefined> {
    return Array.from(this.devices.values()).find(device => device.id === id);
  }

  async createDevice(insertDevice: InsertDevice): Promise<Device> {
    const id = this.deviceIdCounter++;
    const device: Device = {
      ...insertDevice,
      id,
      status: insertDevice.status || 'available',
      lastSeen: new Date(),
    };
    this.devices.set(device.deviceId, device);
    return device;
  }

  async updateDevice(deviceId: string, updates: Partial<Device>): Promise<Device | undefined> {
    const device = this.devices.get(deviceId);
    if (!device) return undefined;

    const updatedDevice: Device = {
      ...device,
      ...updates,
      lastSeen: new Date(),
    };
    this.devices.set(deviceId, updatedDevice);
    return updatedDevice;
  }

  async getAvailableDevices(excludeDeviceId?: string): Promise<Device[]> {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    return Array.from(this.devices.values()).filter(device => 
      device.deviceId !== excludeDeviceId &&
      device.status !== "offline" &&
      device.lastSeen > fiveMinutesAgo
    );
  }

  async setDeviceOffline(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = "offline";
      this.devices.set(deviceId, device);
    }
  }

  async getTransfer(transferId: string): Promise<Transfer | undefined> {
    return this.transfers.get(transferId);
  }

  async createTransfer(insertTransfer: InsertTransfer): Promise<Transfer> {
    const id = this.transferIdCounter++;
    const transfer: Transfer = {
      ...insertTransfer,
      id,
      status: insertTransfer.status || 'pending',
      progress: insertTransfer.progress || 0,
      createdAt: new Date(),
      completedAt: null,
    };
    this.transfers.set(transfer.transferId, transfer);
    return transfer;
  }

  async updateTransfer(transferId: string, updates: Partial<Transfer>): Promise<Transfer | undefined> {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return undefined;

    const updatedTransfer: Transfer = {
      ...transfer,
      ...updates,
      completedAt: (updates.status === "completed" || updates.status === "failed") ? new Date() : transfer.completedAt,
    };
    this.transfers.set(transferId, updatedTransfer);
    return updatedTransfer;
  }

  async getActiveTransfers(deviceId: string): Promise<Transfer[]> {
    return Array.from(this.transfers.values()).filter(transfer =>
      (transfer.senderId === deviceId || transfer.receiverId === deviceId) &&
      ["pending", "accepted", "transferring"].includes(transfer.status)
    );
  }

  async getTransferHistory(deviceId: string, limit = 10): Promise<Transfer[]> {
    return Array.from(this.transfers.values())
      .filter(transfer =>
        (transfer.senderId === deviceId || transfer.receiverId === deviceId) &&
        ["completed", "failed", "rejected"].includes(transfer.status)
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export const storage = new MemStorage();
