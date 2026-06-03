import { Injectable } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { createHmacAuthManagement, type HmacAuthManagement } from "@naskot/node-hmac-auth-management";
import { HmacAuthService } from "./hmac-auth.service";
import { createTypeOrmManagedCrud } from "./typeorm-managed-crud";

type DataPlaneSeed = { clientId: string; secret: string };

function parsePeerTargets() {
  const envKeys = ["PEER_API_A", "PEER_API_B", "PEER_API_C", "PEER_APP_D", "PEER_APP_E"] as const;
  const collected: string[] = [];
  for (const key of envKeys) {
    const value = process.env[key];
    if (value && value.trim()) collected.push(value.trim());
  }
  return collected;
}

function parseDataPlaneSeeds(): DataPlaneSeed[] {
  const raw = process.env.POC_AUTO_SEED_DATA_PLANE;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seeds: DataPlaneSeed[] = [];
    for (const entry of parsed) {
      if (entry && typeof entry === "object") {
        const obj = entry as { clientId?: unknown; secret?: unknown };
        if (typeof obj.clientId === "string" && typeof obj.secret === "string") {
          seeds.push({ clientId: obj.clientId, secret: obj.secret });
        }
      }
    }
    return seeds;
  } catch {
    return [];
  }
}

/**
 * NestJS injectable wrapping `@naskot/node-hmac-auth-management` v0.1.0
 * for api_a (the authority of the POC federation).
 *
 * The service is constructed by an async factory provider in
 * `app.module.ts` that:
 *   1. waits for the upstream HmacAuthService to be ready,
 *   2. waits for the TypeORM DataSource to be initialized,
 *   3. builds the ManagedCrud against the two MariaDB entities,
 *   4. awaits `createHmacAuthManagement` (auto-seeds the propagation
 *      key row when missing).
 *
 * Subsequent calls reach the management surface via `mgmt`. The
 * `tickSync` method is what the scheduler service calls every 20s.
 */
@Injectable()
export class HmacAuthManagementService {
  readonly mgmt: HmacAuthManagement;
  private readonly crud: ReturnType<typeof createTypeOrmManagedCrud>;
  private readonly targets: string[];
  private readonly seeds: DataPlaneSeed[];

  constructor(
    mgmt: HmacAuthManagement,
    crud: ReturnType<typeof createTypeOrmManagedCrud>,
    targets: string[],
    seeds: DataPlaneSeed[]
  ) {
    this.mgmt = mgmt;
    this.crud = crud;
    this.targets = targets;
    this.seeds = seeds;
  }

  static async build(authService: HmacAuthService, dataSource: DataSource) {
    const httpCrud = createTypeOrmManagedCrud(dataSource, "http", authService.auth.secretToken);
    const messageCrud = createTypeOrmManagedCrud(dataSource, "message", authService.auth.secretToken);
    const propagationKeyTargets = parsePeerTargets();
    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth: authService.auth,
      hmacMessageAuth: authService.messageAuth,
      // propagationKey is optional since v0.2.0; default = self_propagation_signer
      propagationKeyTargets,
      http: { crud: httpCrud },
      message: { crud: messageCrud },
      logger: {
        info: (message, context) => console.info(`[mgmt] ${message}`, context ?? {}),
        warn: (message, context) => console.warn(`[mgmt] ${message}`, context ?? {}),
      },
    });
    const seeds = parseDataPlaneSeeds();
    const svc = new HmacAuthManagementService(mgmt, httpCrud, propagationKeyTargets, seeds);
    await svc.healAndSeed();
    return svc;
  }

  // Idempotent self-healing: inserts missing data-plane consumers AND
  // re-injects the plain into any consumer row that ended up in
  // status=error with secret=null (typical after a transient target
  // outage triggered the lib's atomic rollback - e.g. an app_d / app_e
  // prod-rebuild window). Called both at boot and before every sync tick
  // so the POC self-recovers without operator intervention.
  private async healAndSeed() {
    if (this.seeds.length === 0) return;
    if (this.targets.length === 0) {
      console.warn("[mgmt] heal-and-seed skipped: PEER_* env vars missing, no targets to push to");
      return;
    }
    const existing = await this.crud.listAll();
    const byClientId = new Map(existing.map((row) => [row.clientId, row]));
    for (const seed of this.seeds) {
      const row = byClientId.get(seed.clientId);
      if (!row) {
        await this.mgmt.http.add({
          clientId: seed.clientId,
          secret: seed.secret,
          targets: this.targets,
          allowedIps: [],
        });
        console.info(`[mgmt] heal-and-seed: inserted data-plane row`, { clientId: seed.clientId, targets: this.targets });
        continue;
      }
      if (row.status === "error" && !row.secret) {
        await this.mgmt.http.update({ clientId: seed.clientId, newSecret: seed.secret });
        console.info(`[mgmt] heal-and-seed: re-injected plain into errored row`, {
          clientId: seed.clientId,
          previousReason: row.reason,
        });
      }
    }
  }

  async tickSync() {
    // Heal BEFORE every tick so a transient target outage that occurred
    // between two ticks is repaired automatically on the next tick.
    try {
      await this.healAndSeed();
    } catch (error) {
      console.warn("[mgmt] heal-and-seed failed (will retry next tick):", (error as Error).message);
    }
    const httpSummary = await this.mgmt.http.sync();
    if (this.mgmt.message) {
      try {
        await this.mgmt.message.sync();
      } catch (error) {
        console.warn("[mgmt] message sync failed (will retry next tick):", (error as Error).message);
      }
    }
    return httpSummary;
  }
}
