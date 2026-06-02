import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import type { DataSource, Repository } from "typeorm";
import { HmacHttpSeedEntity } from "./entities/hmac-http-seed.entity";
import { HmacHttpSeedDeliveryStateEntity } from "./entities/hmac-http-seed-delivery-state.entity";
import { HmacAuthManagementService } from "./hmac-auth-management.service";

/**
 * No-auth admin REST surface driven by the Nuxt v4 admin page.
 *
 * Endpoints:
 *   GET    /admin/rows                 - list every managed row from MariaDB
 *   GET    /admin/rows/:id             - read one row
 *   POST   /admin/rows                 - create a data-plane row via mgmt.http.add
 *   PUT    /admin/rows/:id             - rotate via mgmt.http.update
 *   DELETE /admin/rows/:id             - flag for deletion via mgmt.http.remove
 *   GET    /admin/delivery-states/:id  - list per-target cursors for a row
 *   POST   /admin/sync                 - trigger an out-of-band sync()
 *
 * Every mutation goes through the management lib (never raw repository
 * writes) so the propagation-key safeguards stay enforced.
 */
@Controller("admin/rows")
export class AdminRowsController {
  constructor(
    @InjectRepository(HmacHttpSeedEntity) private readonly repo: Repository<HmacHttpSeedEntity>,
    private readonly mgmtService: HmacAuthManagementService
  ) {}

  @Get()
  async list() {
    const rows = await this.repo.find({ order: { createdAt: "ASC" } });
    return { ok: true, rows };
  }

  @Get(":id")
  async getById(@Param("id") id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return { ok: false, error: "not found" };
    return { ok: true, row };
  }

  @Post()
  async create(@Body() body: { clientId: string; secret: string; targets: string[]; allowedIps?: string[] }) {
    try {
      const row = await this.mgmtService.mgmt.http.add({
        clientId: body.clientId,
        secret: body.secret,
        targets: body.targets,
        allowedIps: body.allowedIps,
      });
      return { ok: true, row };
    } catch (error: any) {
      return { ok: false, code: error?.code ?? "INTERNAL", error: error?.message ?? String(error) };
    }
  }

  @Put(":id")
  async rotate(@Param("id") id: string, @Body() body: { newSecret: string; targets?: string[]; allowedIps?: string[] }) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return { ok: false, error: "not found" };
    try {
      const updated = await this.mgmtService.mgmt.http.update({
        clientId: row.clientId,
        newSecret: body.newSecret,
        targets: body.targets,
        allowedIps: body.allowedIps,
      });
      return { ok: true, row: updated };
    } catch (error: any) {
      return { ok: false, code: error?.code ?? "INTERNAL", error: error?.message ?? String(error) };
    }
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return { ok: false, error: "not found" };
    try {
      const updated = await this.mgmtService.mgmt.http.remove({ clientId: row.clientId });
      return { ok: true, row: updated };
    } catch (error: any) {
      return { ok: false, code: error?.code ?? "INTERNAL", error: error?.message ?? String(error) };
    }
  }
}

@Controller("admin/delivery-states")
export class AdminDeliveryStatesController {
  constructor(
    @InjectRepository(HmacHttpSeedDeliveryStateEntity)
    private readonly repo: Repository<HmacHttpSeedDeliveryStateEntity>
  ) {}

  @Get(":rowId")
  async list(@Param("rowId") rowId: string) {
    const states = await this.repo.find({ where: { seedId: rowId } });
    return { ok: true, states };
  }
}

@Controller("admin/sync")
export class AdminSyncController {
  constructor(
    private readonly mgmtService: HmacAuthManagementService,
    @InjectDataSource() private readonly dataSource: DataSource
  ) {}

  @Post()
  async syncNow() {
    const summary = await this.mgmtService.mgmt.http.sync();
    void this.dataSource;
    return {
      ok: true,
      summary: {
        durationMs: summary.durationMs,
        rows: summary.rows,
        propagationKey: summary.propagationKey,
        perTarget: Object.fromEntries(
          [...summary.perTarget.entries()].map(([target, value]) => [
            target,
            {
              health: value.health,
              delivered: value.delivered,
              refused: value.refused,
              bootstrappedThisSync: value.bootstrappedThisSync,
            },
          ])
        ),
      },
    };
  }
}
