import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

/**
 * Targets of the inalienable propagation key (`self_propagation_signer`).
 * One row per federation peer that must hold the key. There is NO "key row"
 * to delete: the clientId is hardcoded in the lib + secret derived at boot,
 * so this table only carries the WHERE-TO-PUSH and the per-target delivery
 * cursor inline (state / lastDelivered / attemptCount).
 *
 * The admin surface can ADD a target (= a new API joins the federation) but
 * cannot delete the propagation key itself, since the key never lives here.
 */
@Entity({ name: "hmac_http_propagation_key_targets" })
@Index("idx_prop_key_target_state", ["state"])
export class HmacHttpPropagationKeyTargetEntity {
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

  @CreateDateColumn({ name: "created_at", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", precision: 3 })
  updatedAt!: Date;
}
