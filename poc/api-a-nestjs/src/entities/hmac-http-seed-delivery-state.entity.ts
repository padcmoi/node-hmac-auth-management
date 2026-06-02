import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "hmac_http_seed_delivery_state" })
@Index("idx_http_delivery_state", ["state"])
export class HmacHttpSeedDeliveryStateEntity {
  @PrimaryColumn({ type: "varchar", length: 36, name: "seed_id" })
  seedId!: string;

  @PrimaryColumn({ type: "varchar", length: 255 })
  target!: string;

  @Column({ type: "enum", enum: ["pending", "delivered", "errored"], default: "pending" })
  state!: "pending" | "delivered" | "errored";

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @Column({ type: "datetime", precision: 3, name: "last_attempt_at", nullable: true })
  lastAttemptAt!: Date | null;

  @Column({ type: "datetime", precision: 3, name: "last_delivered_at", nullable: true })
  lastDeliveredAt!: Date | null;

  @Column({ type: "int", unsigned: true, name: "attempt_count", default: 0 })
  attemptCount!: number;

  @UpdateDateColumn({ name: "updated_at", precision: 3 })
  updatedAt!: Date;
}
