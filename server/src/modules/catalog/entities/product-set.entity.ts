import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ProductFeed } from './product-feed.entity';

/**
 * PRODUCT_SET —— 基于商品流定义的商品集（需求 24.3、24.6）。
 *
 * 商品集挂接到具体商品流（feed），动态商品广告通过商品集标识关联；关联不存在的
 * 商品集时由服务层返回「商品集不存在」（需求 24.6）。
 */
@Entity({ name: 'product_set' })
export class ProductSet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_product_set_feed_id')
  @Column({ name: 'feed_id', type: 'uuid' })
  feedId!: string;

  @ManyToOne(() => ProductFeed, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feed_id' })
  feed!: ProductFeed;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  /** 商品集筛选条件。 */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  filter!: Record<string, unknown>;

  /** 平台侧商品集标识。 */
  @Column({ name: 'platform_set_id', type: 'varchar', length: 128, nullable: true })
  platformSetId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
