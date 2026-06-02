import { Injectable } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { createHmacAuthManagement, type HmacAuthManagement } from "@naskot/node-hmac-auth-management";
import { HmacAuthService } from "./hmac-auth.service";
import { createTypeOrmManagedCrud } from "./typeorm-managed-crud";

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

  constructor(mgmt: HmacAuthManagement) {
    this.mgmt = mgmt;
  }

  static async build(authService: HmacAuthService, dataSource: DataSource) {
    const crud = createTypeOrmManagedCrud(dataSource);
    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth: authService.auth,
      propagationKey: process.env.HMAC_PROPAGATION_KEY ?? "self_propagation_signer",
      http: { crud },
      logger: {
        info: (message, context) => console.info(`[mgmt] ${message}`, context ?? {}),
        warn: (message, context) => console.warn(`[mgmt] ${message}`, context ?? {}),
      },
    });
    return new HmacAuthManagementService(mgmt);
  }

  tickSync() {
    return this.mgmt.http.sync();
  }
}
