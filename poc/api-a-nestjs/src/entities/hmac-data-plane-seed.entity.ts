import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * Data-plane seed credentials managed by api_a's `mgmt.<track>.add/update/remove`.
 * v0.2.0 r3: ONE table for both tracks (HTTP + message). The `track` column
 * routes each seed to the right credential store on the target side. The
 * propagation key is NOT in this table (it has no row, see
 * `hmac_http_propagation_key_targets`).
 *
 * Uniqueness:
 *   - (clientId, track) is unique. The same clientId can exist in both
 *     tracks, but never twice in the same track.
 */
@Entity({ name: "hmac_data_plane_seed" })
@Index("uq_data_plane_client_id_track", ["clientId", "track"], { unique: true })
@Index("idx_data_plane_status_track", ["status", "track"])
export class HmacDataPlaneSeedEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 128, name: "client_id" })
  clientId!: string;

  @Column({ type: "enum", enum: ["http", "message"], default: "http" })
  track!: "http" | "message";

  @Column({ type: "text", nullable: true })
  secret!: string | null;

  @Column({ type: "json" })
  targets!: string[];

  @Column({ type: "json", name: "allowed_ips", nullable: true })
  allowedIps!: string[] | null;

  @Column({ type: "enum", enum: ["pending", "ok", "error", "delete_pending"], default: "pending" })
  status!: "pending" | "ok" | "error" | "delete_pending";

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @Column({ type: "datetime", precision: 3, name: "last_synced_at", nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: "int", unsigned: true, name: "attempt_count", default: 0 })
  attemptCount!: number;

  @CreateDateColumn({ name: "created_at", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", precision: 3 })
  updatedAt!: Date;
}
