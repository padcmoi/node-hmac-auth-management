import { Injectable, type OnModuleInit } from "@nestjs/common";
import { HmacAuthManagementService } from "./hmac-auth-management.service";

/**
 * Drives `mgmt.http.sync()` on a fixed cadence. The lib never starts a
 * scheduler itself; the consumer (this POC) plugs one in.
 *
 * Cadence is 20s by default, overridable via MGMT_SYNC_INTERVAL_MS.
 * Each tick logs a one-line summary; errors are caught and logged so
 * one bad sync does not stop the next one.
 */
@Injectable()
export class HmacSyncScheduler implements OnModuleInit {
  constructor(private readonly mgmtService: HmacAuthManagementService) {}

  onModuleInit() {
    const intervalMs = Number(process.env.MGMT_SYNC_INTERVAL_MS ?? 20000);
    setInterval(() => {
      this.mgmtService
        .tickSync()
        .then((summary) => {
          console.info(
            `[mgmt] sync processed=${summary.rows.processed} propagated=${summary.rows.propagated} errored=${summary.rows.errored} deleted=${summary.rows.deleted} durationMs=${summary.durationMs} propKey.pushedThisSync=${summary.propagationKey.pushedThisSync}`
          );
        })
        .catch((error) => {
          console.error("[mgmt] sync failed", error);
        });
    }, intervalMs);
    console.info(`[mgmt] sync scheduler armed every ${intervalMs}ms`);
  }
}
