import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 商品流同步状态（需求 24.2、24.5）。 */
export type FeedSyncStatus = '未同步' | '同步成功' | '同步失败';

/**
 * PRODUCT_FEED —— 统一商品流（需求 24.1、24.2、24.5）。
 *
 * 抽象 Meta Catalog / Google Merchant Center / TikTok Catalog 的统一商品流：
 * - `items`：当前待同步/最新提交的商品条目集合；
 * - `lastSyncedItems`：最近一次**成功**同步的条目快照——同步失败时保留，绝不被失败
 *   数据覆盖（需求 24.5）；
 * - `syncStatus` + `lastSyncAt`（精确到秒）+ `failureReason`：同步状态与失败原因记录。
 */
@Entity({ name: 'product_feed' })
export class ProductFeed {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 归属平台：'meta' | 'google' | 'tiktok'。 */
  @Index('idx_product_feed_platform')
  @Column({ type: 'varchar', length: 16 })
  platform!: string;

  /** 平台侧目录标识（Meta catalog_id / GMC merchantId / TikTok catalog_id）。 */
  @Column({ name: 'platform_catalog_id', type: 'varchar', length: 128, nullable: true })
  platformCatalogId!: string | null;

  /** 当前商品条目集合。 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  items!: unknown[];

  /** 最近一次成功同步的条目快照（失败时保留，需求 24.5）。 */
  @Column({ name: 'last_synced_items', type: 'jsonb', default: () => "'[]'" })
  lastSyncedItems!: unknown[];

  /** 同步状态：「未同步 / 同步成功 / 同步失败」。 */
  @Column({ name: 'sync_status', type: 'varchar', length: 16, default: '未同步' })
  syncStatus!: FeedSyncStatus;

  /** 最近同步时间（精确到秒，需求 24.2）。 */
  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true })
  lastSyncAt!: Date | null;

  /** 同步失败原因（需求 24.5）。 */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
