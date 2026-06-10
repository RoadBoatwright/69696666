import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { ReviewMode } from '../domain/ai-campaign';

/**
 * 全局默认配置作用域固定键（需求 9.4）。
 *
 * 人工审核模式两级配置：以 `scope` 区分全局默认行与单商家覆盖行。
 * 全局默认行的 `scope` 恒为该常量；单商家覆盖行的 `scope` 为商家标识。
 */
export const GLOBAL_REVIEW_MODE_SCOPE = '__global__';

/**
 * REVIEW_MODE_CONFIG —— 人工审核模式两级配置（需求 9.3、9.4）。
 *
 * - `scope`：作用域键。`__global__` 表示全局默认；其余值为商家标识（单商家覆盖）。
 * - `mode`：生效档位（全自动 / 专家把关）。默认关闭即全自动档（需求 9.4）。
 *
 * 解析规则：单商家未覆盖时采用全局默认；同一商家任一时刻有且仅有一个生效档位（需求 9.4）。
 */
@Entity({ name: 'review_mode_config' })
export class ReviewModeConfig {
  /** 作用域键：`__global__`（全局默认）或商家标识（单商家覆盖）。 */
  @PrimaryColumn({ name: 'scope', type: 'varchar', length: 64 })
  scope!: string;

  /** 生效档位（全自动 / 专家把关，需求 9.4）。 */
  @Column({ name: 'mode', type: 'varchar', length: 16 })
  mode!: ReviewMode;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
