import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AdAsset } from './ad-asset.entity';

/** 成品广告素材类型取值域（需求 11.1）。 */
export type AssetType = 'image' | 'video' | 'carousel' | 'pdf';

/**
 * ASSET —— 商家成品广告素材（需求 11.1）。
 *
 * - 归属某 Merchant（`merchant_id`）。
 * - `type`：image | video | carousel | pdf。
 * - `size_bytes`：单文件 ≤ 500MB（应用层校验，需求 11.1），bigint 承载。
 * - `carousel_children`：轮播子素材数量 2-10（应用层校验，需求 11.1）。
 * - `source_type`：来源类型记录（需求 11.1）。
 * - `storage_ref`：系统侧存储引用（对象存储路径/外部托管引用）。
 * - `format`：文件格式（如 mp4/jpg/pdf），用于平台合规校验留痕（需求 11.2）。
 * - `created_at`：精确到秒的上传时间（需求 11.1）。
 */
@Entity({ name: 'asset' })
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_asset_merchant_id')
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @Column({ type: 'varchar', length: 16 })
  type!: AssetType;

  /** 文件大小（字节），≤ 500MB（应用层校验，需求 11.1）。 */
  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  /** 轮播子素材数量 2-10（应用层校验，需求 11.1），非轮播为空。 */
  @Column({ name: 'carousel_children', type: 'int', nullable: true })
  carouselChildren!: number | null;

  /** 来源类型（需求 11.1），如 merchant_upload / external_url 等。 */
  @Column({ name: 'source_type', type: 'varchar', length: 32, nullable: true })
  sourceType!: string | null;

  /** 系统侧存储引用（对象存储路径或外部托管引用）。 */
  @Column({ name: 'storage_ref', type: 'varchar', length: 512, nullable: true })
  storageRef!: string | null;

  /** 文件格式（如 mp4/jpg/pdf），用于平台合规校验留痕（需求 11.2）。 */
  @Column({ type: 'varchar', length: 32, nullable: true })
  format!: string | null;

  @OneToMany(() => AdAsset, (adAsset) => adAsset.asset)
  adAssets!: AdAsset[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
