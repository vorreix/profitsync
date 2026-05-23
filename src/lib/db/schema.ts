import { pgTable, uuid, text, numeric, date, timestamp, integer } from "drizzle-orm/pg-core"

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  company: text("company").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  status: text("status").default("active"),
  notes: text("notes").default(""),
  onboardDate: date("onboard_date"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  category: text("category").default(""),
  date: date("date").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const quotations = pgTable("quotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  prospectName: text("prospect_name").notNull(),
  company: text("company").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  amount: numeric("amount", { precision: 12, scale: 2 }).default("0"),
  status: text("status").default("draft"), // draft | sent | accepted | rejected
  notes: text("notes").default(""),
  linkedClientId: uuid("linked_client_id"), // set when converted to a client
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const transactionAttachments = pgTable("transaction_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
})

export const userProfiles = pgTable("user_profiles", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  currency: text("currency").default("USD"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})
