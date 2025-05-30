import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "laptop", "mobile", "tablet"
  status: text("status").notNull().default("available"), // "available", "busy", "offline"
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
});

export const transfers = pgTable("transfers", {
  id: serial("id").primaryKey(),
  transferId: text("transfer_id").notNull().unique(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  fileType: text("file_type").notNull(),
  senderId: text("sender_id").notNull(),
  receiverId: text("receiver_id").notNull(),
  status: text("status").notNull().default("pending"), // "pending", "accepted", "rejected", "transferring", "completed", "failed"
  progress: integer("progress").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertDeviceSchema = createInsertSchema(devices).omit({
  id: true,
  lastSeen: true,
});

export const insertTransferSchema = createInsertSchema(transfers).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type Device = typeof devices.$inferSelect;
export type InsertTransfer = z.infer<typeof insertTransferSchema>;
export type Transfer = typeof transfers.$inferSelect;

// WebSocket message types
export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("device-register"),
    device: insertDeviceSchema,
  }),
  z.object({
    type: z.literal("device-update"),
    deviceId: z.string(),
    updates: z.object({
      status: z.string().optional(),
      name: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("transfer-offer"),
    transferId: z.string(),
    fileName: z.string(),
    fileSize: z.number(),
    fileType: z.string(),
    senderId: z.string(),
    receiverId: z.string(),
  }),
  z.object({
    type: z.literal("transfer-answer"),
    transferId: z.string(),
    accepted: z.boolean(),
  }),
  z.object({
    type: z.literal("webrtc-offer"),
    transferId: z.string(),
    offer: z.any(),
  }),
  z.object({
    type: z.literal("webrtc-answer"),
    transferId: z.string(),
    answer: z.any(),
  }),
  z.object({
    type: z.literal("webrtc-ice-candidate"),
    transferId: z.string(),
    candidate: z.any(),
  }),
  z.object({
    type: z.literal("transfer-progress"),
    transferId: z.string(),
    progress: z.number(),
  }),
  z.object({
    type: z.literal("transfer-complete"),
    transferId: z.string(),
  }),
  z.object({
    type: z.literal("transfer-error"),
    transferId: z.string(),
    error: z.string(),
  }),
  z.object({
    type: z.literal("ping"),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("pong"),
    timestamp: z.number(),
    originalTimestamp: z.number(),
  }),
]);

export type WSMessage = z.infer<typeof wsMessageSchema>;
