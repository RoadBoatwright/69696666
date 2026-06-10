import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * AUDIT_LOG —— 审计日志（需求 18.6）。
 *
 * 记录越权尝试等安全相关操作，含主体角色、资源标识、动作与
 * 精确到秒发生时间（需求 18.6）。仅追加写入，不可变更。
 */
@Entity({ name: 'audit_log' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 操作主体角色（管理员 | 投手 | 商家）。 */
  @Column({ name: 'actor_role', type: 'varchar', length: 32 })
  actorRole!: string;

  /** 操作主体标识。 */
  @Column({ name: 'actor_id', type: 'varchar', length: 255, nullable: true })
  actorId!: string | null;

  /** 目标资源标识。 */
  @Column({ name: 'resource_id', type: 'varchar', length: 255, nullable: true })
  resourceId!: string | null;

  /** 操作动作。 */
  @Column({ type: 'varchar', length: 64 })
  action!: string;

  /** 发生时间，精确到秒（需求 18.6）。 */
  @Index('idx_audit_log_occurred_at')
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
