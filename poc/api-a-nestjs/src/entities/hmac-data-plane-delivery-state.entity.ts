import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { HmacDataPlaneSeedEntity } from "./hmac-data-plane-seed.entity";

/**
 * Per-(seed, target) cursor for data-plane seeds. Shared between HTTP and
 * message tracks; the parent `seed_id` foreign key encodes the track via
 * its parent row.
 *
 * Schema:
 *   - `id` UUID standalone primary key.
 *   - `seed_id` FK to `hmac_data_plane_seed.id` with ON DELETE CASCADE so
 *     deleting a seed automatically wipes its delivery-state cursors.
 *   - UNIQUE(`seed_id`, `target`) keeps the at-most-one-cursor-per-target
 *     invariant the lib relies on.
 */
@Entity({ name: "hmac_data_plane_delivery_state" })
@Index("uq_data_plane_delivery_state_seed_target", ["seedId", "target"], { unique: true })
@Index("idx_data_plane_delivery_state_state", ["state"])
export class HmacDataPlaneDeliveryStateEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // FK column is declared via @JoinColumn below. We keep `seedId` as a
  // typed convenience for queries (save / where / findOne by FK) without a
  // separate @Column - TypeORM raises "does not support length property"
  // if the same DB column is decorated twice.
  @ManyToOne(() => HmacDataPlaneSeedEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "seed_id" })
  seed!: HmacDataPlaneSeedEntity;

  @Column({ name: "seed_id" })
  seedId!: string;

  @Column({ type: "varchar", length: 255 })
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
