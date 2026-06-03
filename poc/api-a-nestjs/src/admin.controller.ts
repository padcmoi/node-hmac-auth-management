import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import type { DataSource, Repository } from "typeorm";
import { HmacHttpPropagationKeyTargetEntity } from "./entities/hmac-http-propagation-key-target.entity";
import { HmacDataPlaneSeedEntity } from "./entities/hmac-data-plane-seed.entity";
import { HmacDataPlaneDeliveryStateEntity } from "./entities/hmac-data-plane-delivery-state.entity";
import { HmacAuthManagementService } from "./hmac-auth-management.service";

/**
 * v0.2.0 r3 admin REST surface:
 *
 *   GET    /admin/propagation-key/targets               - list rows from
 *                                                          hmac_http_propagation_key_targets
 *   POST   /admin/propagation-key/targets               - add (union) a new
 *                                                          target to the
 *                                                          inalienable list
 *
 *   GET    /admin/data-plane?track=http|message         - list seeds (default http)
 *   GET    /admin/data-plane/:id                        - read one seed
 *   POST   /admin/data-plane                            - create via mgmt.<track>.add
 *   PUT    /admin/data-plane/:id                        - rotate via mgmt.<track>.update
 *   DELETE /admin/data-plane/:id                        - flag via mgmt.<track>.remove
 *   GET    /admin/data-plane/:id/delivery-states        - list cursors
 *
 *   POST   /admin/sync?track=http|message               - trigger sync (default http)
 *
 * No mention of the propagation-key clientId anywhere on this surface: the
 * key is inalienable and INTERNAL to the lib (hardcoded constant, derived
 * secret). The admin manages WHERE it lands, not WHAT it is.
 */
@Controller("admin/propagation-key/targets")
export class AdminPropagationKeyTargetsController {
  constructor(
    @InjectRepository(HmacHttpPropagationKeyTargetEntity)
    private readonly repo: Repository<HmacHttpPropagationKeyTargetEntity>
  ) {}

  @Get()
  async list() {
    const rows = await this.repo.find({ order: { target: "ASC" } });
    return { ok: true, rows };
  }

  @Post()
  async add(@Body() body: { target: string }) {
    const target = (body?.target ?? "").trim();
    if (!target) return { ok: false, error: "target is required" };
    const existing = await this.repo.findOne({ where: { target } });
    if (existing) return { ok: true, row: existing, note: "already present" };
    const saved = await this.repo.save(this.repo.create({ target, state: "pending", reason: null, attemptCount: 0 }));
    return { ok: true, row: saved };
  }
}

@Controller("admin/data-plane")
export class AdminDataPlaneController {
  constructor(
    @InjectRepository(HmacDataPlaneSeedEntity) private readonly repo: Repository<HmacDataPlaneSeedEntity>,
    @InjectRepository(HmacDataPlaneDeliveryStateEntity)
    private readonly stateRepo: Repository<HmacDataPlaneDeliveryStateEntity>,
    private readonly mgmtService: HmacAuthManagementService
  ) {}

  private trackFromQuery(track?: string): "http" | "message" {
    return track === "message" ? "message" : "http";
  }

  @Get()
  async list(@Query("track") track?: string) {
    const t = this.trackFromQuery(track);
    const rows = await this.repo.find({ where: { track: t }, order: { createdAt: "ASC" } });
    return { ok: true, track: t, rows };
  }

  @Get(":id")
  async getById(@Param("id") id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return { ok: false, error: "not found" };
    return { ok: true, row };
  }

  @Get(":id/delivery-states")
  async deliveryStates(@Param("id") id: string) {
    const states = await this.stateRepo.find({ where: { seedId: id } });
    return { ok: true, states };
  }

  @Post()
  async create(
    @Body()
    body: {
      clientId: string;
      secret: string;
      targets: string[];
      allowedIps?: string[];
      track?: "http" | "message";
    }
  ) {
    const track = this.trackFromQuery(body.track);
    const surface = track === "message" ? this.mgmtService.mgmt.message : this.mgmtService.mgmt.http;
    if (!surface) return { ok: false, error: `${track} track not configured on this api_a build` };
    try {
      const row = await surface.add({
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
    const surface = row.track === "message" ? this.mgmtService.mgmt.message : this.mgmtService.mgmt.http;
    if (!surface) return { ok: false, error: `${row.track} track not configured on this api_a build` };
    try {
      const updated = await surface.update({
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
    const surface = row.track === "message" ? this.mgmtService.mgmt.message : this.mgmtService.mgmt.http;
    if (!surface) return { ok: false, error: `${row.track} track not configured on this api_a build` };
    try {
      const updated = await surface.remove({ clientId: row.clientId });
      return { ok: true, row: updated };
    } catch (error: any) {
      return { ok: false, code: error?.code ?? "INTERNAL", error: error?.message ?? String(error) };
    }
  }
}

@Controller("admin/sync")
export class AdminSyncController {
  constructor(
    private readonly mgmtService: HmacAuthManagementService,
    @InjectDataSource() private readonly dataSource: DataSource
  ) {}

  @Post()
  async syncNow(@Query("track") track?: string) {
    const t: "http" | "message" = track === "message" ? "message" : "http";
    const surface = t === "message" ? this.mgmtService.mgmt.message : this.mgmtService.mgmt.http;
    if (!surface) return { ok: false, error: `${t} track not configured on this api_a build` };
    const summary = await surface.sync();
    void this.dataSource;
    return {
      ok: true,
      track: t,
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
