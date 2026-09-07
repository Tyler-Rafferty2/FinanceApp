import { pgTable, pgEnum, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  cognitoSub: text("cognito_sub").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(), // admin | manager | employee — permission level
  jobTitle: text("job_title"), // e.g. "Cashier" — descriptive only, not permissions
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shiftStatus = pgEnum("shift_status", ["scheduled", "completed", "cancelled"]);

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeId: uuid("employee_id").notNull().references(() => users.id),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  location: text("location"),
  description: text("description"), // what they're doing this shift, e.g. "Cashier - gift shop"
  status: shiftStatus("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationType = pgEnum("notification_type", ["shift_created", "shift_updated", "shift_reminder"]);
export const notificationStatus = pgEnum("notification_status", ["sent", "failed"]);

export const notificationsLog = pgTable("notifications_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  shiftId: uuid("shift_id").notNull().references(() => shifts.id),
  type: notificationType("type").notNull(),
  status: notificationStatus("status").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
