# NestJS Guide

This guide shows a minimal, production-oriented setup for driving `@naskot/node-hmac-auth-management` from a NestJS app. The lib is framework-agnostic; the NestJS bits are:

- a `HmacMgmtModule` that provides `HmacAuthManagement` as an injectable,
- a `@Cron()` decorator that calls `mgmt.http.sync()` on a cadence,
- a TypeORM-backed `ManagedCrud` repository service.

## 1) Install

```bash
npm install @naskot/node-hmac-auth-management @naskot/node-hmac-auth @nestjs/common @nestjs/core @nestjs/platform-express @nestjs/schedule @nestjs/typeorm typeorm redis reflect-metadata rxjs
```

## 2) Initialize Redis + upstream HMAC at boot

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { createHmacRuntime } from "./hmac.runtime";

async function bootstrap() {
  const runtime = await createHmacRuntime();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    rawBody: true,
  });
  app.set("trust proxy", true);
  app.useBodyParser("json");
  // IMPORTANT: even with `rawBody: true`, body-less verbs (GET, DELETE,
  // sometimes PATCH) leave `req.rawBody` undefined. The upstream lib
  // then falls back to `req.body` (which the JSON parser sets to `{}`)
  // and signs `JSON.stringify({}) === "{}"` server-side while the
  // client signed `""`. The result is a spurious BAD_SIGNATURE. Force
  // an empty Buffer so both sides agree on `hash("")`.
  app.use((req: any, _res: any, next: any) => {
    if (!req.rawBody) req.rawBody = Buffer.alloc(0);
    next();
  });
  app.use(runtime.hmacHttpAuth.createInternalManagementMiddleware());

  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
  console.info(`[authority] listening on :${process.env.PORT ?? 3000}`);
}

void bootstrap();
```

## 3) Build the runtime in a single module

```ts
import { createClient } from "redis";
import { initializeHmacHttpAuth, type InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";
import { createHmacAuthManagement, type HmacAuthManagement } from "@naskot/node-hmac-auth-management";

export interface HmacRuntime {
  hmacHttpAuth: InitializedHmacHttpAuth;
  mgmt: HmacAuthManagement;
}

export async function createHmacRuntime() {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  const hmacHttpAuth = initializeHmacHttpAuth({
    redis,
    namespace: process.env.HMAC_NAMESPACE ?? "my-authority",
    secretToken: process.env.HMAC_SECRET_TOKEN,
    internalManagementRoute: "/api/internal/hmac",
    requireBootstrapClientId: "self_propagation_signer",
  });

  // The CRUD comes from TypeORM (see §5 below). Substitute your own if
  // you use Prisma or anything else.
  const { TypeOrmManagedCrudService } = await import("./typeorm-managed-crud.service");
  const crud = new TypeOrmManagedCrudService(/* inject your repos here */);

  const mgmt = await createHmacAuthManagement({
    hmacHttpAuth,
    propagationKey: "self_propagation_signer",
    http: { crud },
  });

  return { hmacHttpAuth, mgmt };
}
```

## 4) Provide the runtime + drive sync() via @Cron()

```ts
import { Module, Inject, Injectable } from "@nestjs/common";
import { Cron, CronExpression, ScheduleModule } from "@nestjs/schedule";
import type { HmacRuntime } from "./hmac.runtime";

export const HMAC_RUNTIME = Symbol("HMAC_RUNTIME");

@Injectable()
export class HmacSyncCron {
  constructor(@Inject(HMAC_RUNTIME) private readonly runtime: HmacRuntime) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick() {
    const summary = await this.runtime.mgmt.http.sync();
    console.info(
      `[mgmt] sync processed=${summary.rows.processed} propagated=${summary.rows.propagated} errored=${summary.rows.errored} deleted=${summary.rows.deleted}`
    );
  }
}

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    { provide: HMAC_RUNTIME, useFactory: async () => (await import("./hmac.runtime")).createHmacRuntime() },
    HmacSyncCron,
  ],
  exports: [HMAC_RUNTIME],
})
export class HmacMgmtModule {}
```

## 5) TypeORM-backed CRUD

Schema:

```sql
CREATE TABLE hmac_http_seed (
  id              VARCHAR(36)  NOT NULL,
  client_id       VARCHAR(128) NOT NULL,
  kind            ENUM('data_plane','propagation_key') NOT NULL DEFAULT 'data_plane',
  secret          TEXT         NULL,
  targets         JSON         NOT NULL,
  allowed_ips     JSON         NULL,
  status          ENUM('pending','ok','error','delete_pending') NOT NULL DEFAULT 'pending',
  reason          TEXT         NULL,
  last_synced_at  DATETIME(3)  NULL,
  attempt_count   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE INDEX uq_http_client_id (client_id),
  INDEX idx_http_status_kind (status, kind)
) ENGINE=InnoDB;

CREATE TABLE hmac_http_seed_delivery_state (
  seed_id            VARCHAR(36)  NOT NULL,
  target             VARCHAR(512) NOT NULL,
  state              ENUM('pending','delivered','errored') NOT NULL DEFAULT 'pending',
  reason             TEXT         NULL,
  last_attempt_at    DATETIME(3)  NULL,
  last_delivered_at  DATETIME(3)  NULL,
  attempt_count      INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (seed_id, target),
  FOREIGN KEY (seed_id) REFERENCES hmac_http_seed(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

Service:

```ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type {
  DeliveryStateRecord,
  DeliveryStateUpdatePatch,
  ManagedCrud,
  ManagedRow,
  ManagedRowCreateInput,
  ManagedRowUpdatePatch,
} from "@naskot/node-hmac-auth-management";
import { HmacHttpSeedEntity } from "./entities/hmac-http-seed.entity";
import { HmacHttpSeedDeliveryStateEntity } from "./entities/hmac-http-seed-delivery-state.entity";

@Injectable()
export class TypeOrmManagedCrudService implements ManagedCrud {
  constructor(
    @InjectRepository(HmacHttpSeedEntity) private readonly seedRepo: Repository<HmacHttpSeedEntity>,
    @InjectRepository(HmacHttpSeedDeliveryStateEntity) private readonly stateRepo: Repository<HmacHttpSeedDeliveryStateEntity>
  ) {}

  async listPending() {
    const entities = await this.seedRepo.find({ where: [{ status: "pending" }, { status: "delete_pending" }] });
    return entities.map(this.toRow);
  }
  async listAll() {
    return (await this.seedRepo.find()).map(this.toRow);
  }
  async getById(id: string) {
    const e = await this.seedRepo.findOne({ where: { id } });
    return e ? this.toRow(e) : null;
  }
  async getByClientId(clientId: string) {
    const e = await this.seedRepo.findOne({ where: { clientId } });
    return e ? this.toRow(e) : null;
  }
  async getPropagationKeyRow() {
    const e = await this.seedRepo.findOne({ where: { kind: "propagation_key" } });
    return e ? this.toRow(e) : null;
  }
  async create(input: ManagedRowCreateInput) {
    const e = this.seedRepo.create({
      id: input.id,
      clientId: input.clientId,
      kind: input.kind,
      secret: input.secret,
      targets: input.targets,
      allowedIps: input.allowedIps ?? null,
      status: "pending",
      reason: null,
    });
    const saved = await this.seedRepo.save(e);
    return this.toRow(saved);
  }
  async update(id: string, patch: ManagedRowUpdatePatch) {
    await this.seedRepo.update({ id }, patch as Partial<HmacHttpSeedEntity>);
  }
  async delete(id: string) {
    await this.seedRepo.delete({ id });
  }
  async getDeliveryState(rowId: string, target: string) {
    const e = await this.stateRepo.findOne({ where: { seedId: rowId, target } });
    if (!e) return null;
    const record: DeliveryStateRecord = {
      state: e.state,
      reason: e.reason ?? null,
      lastAttemptAt: e.lastAttemptAt ?? null,
      lastDeliveredAt: e.lastDeliveredAt ?? null,
      attemptCount: e.attemptCount,
    };
    return record;
  }
  async setDeliveryState(rowId: string, target: string, patch: DeliveryStateUpdatePatch) {
    await this.stateRepo.save({
      seedId: rowId,
      target,
      state: patch.state,
      reason: patch.reason ?? null,
      lastAttemptAt: patch.lastAttemptAt,
      lastDeliveredAt: patch.lastDeliveredAt ?? null,
      attemptCount: patch.attemptCount,
    });
  }

  private toRow = (e: HmacHttpSeedEntity) => {
    const row: ManagedRow = {
      id: e.id,
      clientId: e.clientId,
      kind: e.kind,
      secret: e.secret,
      targets: e.targets,
      allowedIps: e.allowedIps,
      status: e.status,
      reason: e.reason,
      lastSyncedAt: e.lastSyncedAt,
      attemptCount: e.attemptCount,
    };
    return row;
  };
}
```

## 6) Operator routes (optional)

```ts
import { Body, Controller, Inject, Post } from "@nestjs/common";
import { HMAC_RUNTIME } from "./hmac-mgmt.module";
import type { HmacRuntime } from "./hmac.runtime";

@Controller("admin/credentials")
export class CredentialsAdminController {
  constructor(@Inject(HMAC_RUNTIME) private readonly runtime: HmacRuntime) {}

  @Post()
  async add(@Body() body: { clientId: string; secret: string; targets: string[]; allowedIps?: string[] }) {
    return this.runtime.mgmt.http.add(body);
  }

  @Post("sync")
  async syncNow() {
    return this.runtime.mgmt.http.sync();
  }
}
```

Wrap these endpoints with the upstream's `verifyHttpRequest` middleware (or your usual auth guard) so non-operator clients cannot trigger administrative mutations.

## 7) Behavior summary

- `mgmt.http.add` / `update` / `remove` only write the BDD.
- `mgmt.http.sync()` is the only call that touches Redis or the network. Drive it from `@Cron()` (recommended), `@Interval()`, or a queue handler.
- The propagation-key clientId is reserved. Attempting `add` / `update` / `remove` on it throws `HmacAuthMgmtError` with `code === "PROPAGATION_KEY_REMOVE_FORBIDDEN"`.

The full wire specification is in the upstream's [docs/wire-contract.md](https://github.com/padcmoi/node-hmac-auth/blob/main/docs/wire-contract.md).
