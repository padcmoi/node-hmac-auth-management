import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "hmac_http_seed" })
@Index("uq_http_client_id", ["clientId"], { unique: true })
@Index("idx_http_status_kind", ["status", "kind"])
export class HmacHttpSeedEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 128, name: "client_id" })
  clientId!: string;

  @Column({ type: "enum", enum: ["data_plane", "propagation_key"], default: "data_plane" })
  kind!: "data_plane" | "propagation_key";

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
