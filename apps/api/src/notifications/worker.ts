import { and, eq, isNull, sql } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client";
import { loadEnv } from "../config/env";
import { createLogger, type Logger } from "../lib/logger";
import { notificationDeliveryAttempts, notificationOutbox, notifications, pushDevices } from "../db/schema";
import { createNotificationsService } from "../domain/notifications/service";

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: { target: { kind: string; id: string } };
};

export type PushSendResult = { ok: true; ticketId: string } | { ok: false; errorCode?: string };

export interface PushProvider {
  send(message: PushMessage): Promise<PushSendResult>;
  getReceipts?(ticketIds: string[]): Promise<Map<string, { ok: boolean; errorCode?: string }>>;
}

export class ExpoPushProvider implements PushProvider {
  constructor(private readonly accessToken?: string) {}

  async send(message: PushMessage): Promise<PushSendResult> {
    const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json" });
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const response = await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers, body: JSON.stringify(message) });
    if (!response.ok) throw new Error("Push provider unavailable");
    const body = await response.json() as { data?: { status?: string; id?: string; details?: { error?: string } } };
    const ticket = body.data;
    if (!ticket || ticket.status !== "ok" || !ticket.id) return { ok: false, errorCode: ticket?.details?.error };
    return { ok: true, ticketId: ticket.id };
  }

  async getReceipts(ticketIds: string[]): Promise<Map<string, { ok: boolean; errorCode?: string }>> {
    if (ticketIds.length === 0) return new Map();
    const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json" });
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", { method: "POST", headers, body: JSON.stringify({ ids: ticketIds }) });
    if (!response.ok) throw new Error("Push receipt provider unavailable");
    const body = await response.json() as { data?: Record<string, { status?: string; details?: { error?: string } }> };
    const result = new Map<string, { ok: boolean; errorCode?: string }>();
    for (const [id, receipt] of Object.entries(body.data ?? {})) result.set(id, { ok: receipt.status === "ok", errorCode: receipt.details?.error });
    return result;
  }
}

type ClaimedOutbox = { id: string; notification_id: string; device_id: string; attempt_count: number };

export class NotificationWorker {
  private readonly service;

  constructor(private readonly db: Database, private readonly provider: PushProvider, private readonly logger: Logger, private readonly options: { batchSize?: number; maxAttempts?: number } = {}) {
    this.service = createNotificationsService(db);
  }

  async processOnce(): Promise<{ routed: number; sent: number; receipts: number }> {
    const routed = await this.service.routePendingEvents(this.options.batchSize ?? 100);
    const receipts = await this.syncReceipts(this.options.batchSize ?? 100);
    const claimed = await this.claimBatch(this.options.batchSize ?? 100);
    let sent = 0;
    for (const row of claimed) if (await this.deliver(row)) sent += 1;
    return { routed, sent, receipts };
  }

  async run(options: { once?: boolean; pollMs?: number } = {}): Promise<void> {
    do {
      const result = await this.processOnce();
      this.logger.info("Notification worker cycle complete", result);
      if (options.once) return;
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 5_000));
    } while (true);
  }

  private async claimBatch(limit: number): Promise<ClaimedOutbox[]> {
    const rows = await this.db.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM notification_outbox
        WHERE (status IN ('pending', 'retry') AND next_attempt_at <= now())
           OR (status = 'claimed' AND claimed_at < now() - interval '5 minutes')
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE notification_outbox AS outbox
      SET status = 'claimed', claimed_at = now(), attempt_count = outbox.attempt_count + 1, updated_at = now()
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.notification_id, outbox.device_id, outbox.attempt_count
    `);
    return Array.from(rows as unknown as Iterable<ClaimedOutbox>);
  }

  private async deliver(row: ClaimedOutbox): Promise<boolean> {
    const [item] = await this.db.select({ outbox: notificationOutbox, notification: notifications, device: pushDevices }).from(notificationOutbox).innerJoin(notifications, eq(notifications.id, notificationOutbox.notificationId)).innerJoin(pushDevices, eq(pushDevices.id, notificationOutbox.deviceId)).where(eq(notificationOutbox.id, row.id)).limit(1);
    if (!item || item.device.invalidatedAt) {
      await this.recordAttempt(row, "permanent", "DEVICE_NOT_REGISTERED");
      await this.markPermanent(row.id, "Устройство больше не зарегистрировано");
      return false;
    }
    const message: PushMessage = {
      to: item.device.expoPushToken,
      title: item.notification.title,
      body: item.notification.body,
      ...(item.notification.targetKind && item.notification.targetId ? { data: { target: { kind: item.notification.targetKind, id: item.notification.targetId } } } : {}),
    };
    try {
      const result = await this.provider.send(message);
      if (result.ok) {
        await this.recordAttempt(row, "accepted", undefined, result.ticketId);
        await this.db.update(notificationOutbox).set({ status: "accepted", providerTicketId: result.ticketId, claimedAt: null, updatedAt: new Date(), lastError: null }).where(eq(notificationOutbox.id, row.id));
        return true;
      }
      if (result.errorCode === "DeviceNotRegistered" || result.errorCode === "InvalidCredentials") {
        await this.recordAttempt(row, "permanent", result.errorCode);
        await this.db.update(pushDevices).set({ invalidatedAt: new Date(), updatedAt: new Date() }).where(eq(pushDevices.id, item.device.id));
        await this.markPermanent(row.id, "Токен устройства отклонён провайдером");
        return false;
      }
      const reason = result.errorCode ?? "Push ticket rejected";
      await this.recordAttempt(row, row.attempt_count >= (this.options.maxAttempts ?? 6) ? "permanent" : "retry", reason);
      await this.retry(row, reason);
      return false;
    } catch (error) {
      this.logger.warn("Push delivery failed", { error: error instanceof Error ? error.message : "unknown" });
      await this.recordAttempt(row, row.attempt_count >= (this.options.maxAttempts ?? 6) ? "permanent" : "retry", "PROVIDER_UNAVAILABLE");
      await this.retry(row, "Push provider unavailable");
      return false;
    }
  }

  private async retry(row: ClaimedOutbox, reason: string): Promise<void> {
    const maxAttempts = this.options.maxAttempts ?? 6;
    if (row.attempt_count >= maxAttempts) return this.markPermanent(row.id, reason);
    const delayMs = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.min(row.attempt_count - 1, 7)));
    await this.db.update(notificationOutbox).set({ status: "retry", nextAttemptAt: new Date(Date.now() + delayMs), claimedAt: null, lastError: reason, updatedAt: new Date() }).where(eq(notificationOutbox.id, row.id));
  }

  private async markPermanent(id: string, reason: string): Promise<void> {
    await this.db.update(notificationOutbox).set({ status: "permanent", claimedAt: null, lastError: reason, updatedAt: new Date() }).where(eq(notificationOutbox.id, id));
  }

  private async recordAttempt(row: ClaimedOutbox, status: "accepted" | "retry" | "permanent", errorCode?: string, providerTicketId?: string): Promise<void> {
    await this.db.insert(notificationDeliveryAttempts).values({ outboxId: row.id, attemptNumber: row.attempt_count, status, errorCode: errorCode ?? null, providerTicketId: providerTicketId ?? null });
  }

  private async syncReceipts(limit: number): Promise<number> {
    if (!this.provider.getReceipts) return 0;
    const rows = await this.db.select({ id: notificationOutbox.id, ticketId: notificationOutbox.providerTicketId, deviceId: notificationOutbox.deviceId }).from(notificationOutbox).where(and(eq(notificationOutbox.status, "accepted"), sql`${notificationOutbox.providerTicketId} is not null`, isNull(notificationOutbox.providerReceiptId))).limit(limit);
    const ticketRows = rows.filter((row): row is { id: string; ticketId: string; deviceId: string } => Boolean(row.ticketId));
    if (ticketRows.length === 0) return 0;
    let receipts: Map<string, { ok: boolean; errorCode?: string }>;
    try { receipts = await this.provider.getReceipts(ticketRows.map((row) => row.ticketId)); } catch (error) {
      this.logger.warn("Push receipt lookup failed", { error: error instanceof Error ? error.message : "unknown" });
      return 0;
    }
    let processed = 0;
    for (const row of ticketRows) {
      const receipt = receipts.get(row.ticketId);
      if (!receipt) continue;
      processed += 1;
      if (receipt.ok) {
        await this.db.update(notificationOutbox).set({ providerReceiptId: row.ticketId, updatedAt: new Date() }).where(eq(notificationOutbox.id, row.id));
      } else if (receipt.errorCode === "DeviceNotRegistered") {
        await this.db.update(pushDevices).set({ invalidatedAt: new Date(), updatedAt: new Date() }).where(eq(pushDevices.id, row.deviceId));
        await this.db.update(notificationOutbox).set({ providerReceiptId: row.ticketId, updatedAt: new Date() }).where(eq(notificationOutbox.id, row.id));
        await this.markPermanent(row.id, "Токен устройства отклонён в receipt");
      } else {
        await this.db.update(notificationOutbox).set({ providerReceiptId: row.ticketId, updatedAt: new Date() }).where(eq(notificationOutbox.id, row.id));
        await this.markPermanent(row.id, receipt.errorCode ?? "Push receipt rejected");
      }
    }
    return processed;
  }
}

export async function runNotificationWorker(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const { db, client } = createDatabase(env);
  const worker = new NotificationWorker(db, new ExpoPushProvider(env.EXPO_PUSH_ACCESS_TOKEN), logger, { batchSize: env.NOTIFICATION_WORKER_BATCH_SIZE, maxAttempts: env.NOTIFICATION_WORKER_MAX_ATTEMPTS });
  try {
    await worker.run({ once: process.argv.includes("--once"), pollMs: env.NOTIFICATION_WORKER_POLL_MS });
  } finally {
    await client.end();
  }
}

if (import.meta.main) await runNotificationWorker();
