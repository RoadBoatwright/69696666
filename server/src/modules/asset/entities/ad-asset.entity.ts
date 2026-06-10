import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Asset } from './asset.entity';
import { Ad } from '../../campaign/entities/ad.entity';

/**
 * AD_ASSET —— 广告与素材的引用关系（需求 9.4、9.5、9.7）。
 *
 * 复合主键（ad_id, asset_id），两端均为非空外键。
 * - `platform_ref`：平台素材引用标识。
 * - `ref_status`：引用状态，平台引用失败时保留以待重试（需求 9.5）。
 *   存在引用关系即表示素材被引用，不可删除（需求 9.7）。
 */
@Entity({ name: 'ad_asset' })
export class AdAsset {
  @Index('idx_ad_asset_ad_id')
  @PrimaryColumn({ name: 'ad_id', type: 'uuid' })
  adId!: string;

  @Index('idx_ad_asset_asset_id')
  @PrimaryColumn({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @ManyToOne(() => Ad, (ad) => ad.adAssets, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ad_id' })
  ad!: Ad;

  @ManyToOne(() => Asset, (asset) => asset.adAssets, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;

  /** 平台素材引用标识。 */
  @Column({ name: 'platform_ref', type: 'varchar', length: 255, nullable: true })
  platformRef!: string | null;

  /** 引用状态，平台引用失败时保留以待重试（需求 9.5）。 */
  @Column({ name: 'ref_status', type: 'varchar', length: 32, nullable: true })
  refStatus!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
