/**
 * 素材服务领域类型（组件 7，需求 11）。
 *
 * 平台无关的成品广告素材上传校验、单份失败隔离、复用/删除领域定义，
 * 被 {@link ../asset.service} 与纯函数库 {@link ../pure/asset-validation.pure} 共用。
 *
 * 定位：系统对成品素材只做**平台合规校验（格式/尺寸/时长/文件大小）与挂载/引用**，
 * 不做创意设计或改写。
 */
import type { AssetType } from '../entities/asset.entity';

export type { AssetType };

// ---------------------------------------------------------------------------
// 约束常量（需求 11.1、11.2）
// ---------------------------------------------------------------------------

/** 单文件大小上限：500MB（字节，需求 11.1）。 */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/** 轮播子素材数量下限（需求 11.1）。 */
export const CAROUSEL_CHILDREN_MIN = 2;

/** 轮播子素材数量上限（需求 11.1）。 */
export const CAROUSEL_CHILDREN_MAX = 10;

/** 支持的成品素材类型（需求 11.1）。 */
export const ASSET_TYPES: readonly AssetType[] = ['image', 'video', 'carousel', 'pdf'];

// ---------------------------------------------------------------------------
// 平台合规规格（需求 11.2）
// ---------------------------------------------------------------------------

/** 目标平台对某素材类型的成品广告投放合规要求（需求 11.2）。 */
export interface PlatformAssetSpec {
  /** 允许的文件格式（小写扩展名，如 mp4/jpg）；为空表示不限制格式。 */
  allowedFormats: readonly string[];
  /** 该类型在该平台允许的单文件大小上限（字节）；不超过系统上限。 */
  maxSizeBytes: number;
  /** 视频时长下限（秒），仅视频类型适用；可空。 */
  minDurationSec?: number;
  /** 视频时长上限（秒），仅视频类型适用；可空。 */
  maxDurationSec?: number;
  /** 最小宽度（像素）；可空。 */
  minWidth?: number;
  /** 最小高度（像素）；可空。 */
  minHeight?: number;
  /** 最大宽度（像素）；可空。 */
  maxWidth?: number;
  /** 最大高度（像素）；可空。 */
  maxHeight?: number;
}

// ---------------------------------------------------------------------------
// 校验错误（需求 11.2）
// ---------------------------------------------------------------------------

/** 素材不符合项原因分类（与需求文案对齐的稳定标识）。 */
export type AssetErrorCode =
  | 'required_missing' // 必填字段缺失（需求 11.1）
  | 'type_unsupported' // 素材类型不受支持（需求 11.1）
  | 'size_exceeds_limit' // 文件大小超出系统上限或平台上限（需求 11.2）
  | 'carousel_children_out_of_range' // 轮播子素材数量越界（需求 11.1）
  | 'format_unsupported' // 文件格式不符合平台要求（需求 11.2）
  | 'duration_out_of_range' // 视频时长不符合平台要求（需求 11.2）
  | 'dimension_out_of_range'; // 尺寸不符合平台要求（需求 11.2）

/** 单条素材不符合项（含字段名与原因分类，需求 11.2）。 */
export interface AssetValidationError {
  /** 涉及的字段名（如 `sizeBytes`、`format`、`durationSec`）。 */
  field: string;
  /** 原因分类。 */
  code: AssetErrorCode;
  /** 面向用户的中文提示文案。 */
  message: string;
}

// ---------------------------------------------------------------------------
// 上传输入与批量结果（需求 11.1、11.3）
// ---------------------------------------------------------------------------

/** 单份成品素材上传输入（需求 11.1）。 */
export interface AssetUploadInput {
  /** 归属商家标识（必填）。 */
  merchantId: string;
  /** 成品素材类型（必填，需求 11.1）。 */
  type: AssetType;
  /** 文件大小（字节，必填，需求 11.1）。 */
  sizeBytes: number;
  /** 文件格式（如 mp4/jpg/pdf），用于平台合规校验（需求 11.2）。 */
  format?: string | null;
  /** 轮播子素材数量，轮播类型必填且为 2-10（需求 11.1）。 */
  carouselChildren?: number | null;
  /** 视频时长（秒），视频类型用于平台合规校验（需求 11.2）。 */
  durationSec?: number | null;
  /** 素材宽度（像素），用于平台尺寸合规校验（需求 11.2）。 */
  width?: number | null;
  /** 素材高度（像素），用于平台尺寸合规校验（需求 11.2）。 */
  height?: number | null;
  /** 来源类型（需求 11.1）。 */
  sourceType?: string | null;
  /** 客户端提供的批内引用键，用于在批量结果中回指失败/成功项。 */
  clientRef?: string;
}

/** 单份素材上传成功结果（需求 11.1）。 */
export interface AssetUploadSuccess {
  /** 批内引用键（与输入一致，便于调用方对齐）。 */
  clientRef?: string;
  /** 上传成功指示（需求 11.1）。 */
  uploaded: true;
  /** 生成的唯一素材标识（需求 11.1）。 */
  assetId: string;
}

/** 单份素材上传失败结果（需求 11.2、11.3）。 */
export interface AssetUploadFailure {
  /** 批内引用键（与输入一致，便于调用方对齐）。 */
  clientRef?: string;
  /** 上传失败指示。 */
  uploaded: false;
  /** 失败原因分类：`validation` 合规校验不通过；`storage` 存储/网络中断（需求 11.2、11.3）。 */
  reason: 'validation' | 'storage';
  /** 校验不符合项集合（reason=validation 时返回全部不符合项，需求 11.2）。 */
  errors?: AssetValidationError[];
  /** 存储/网络中断时的失败原因说明（需求 11.3）。 */
  message?: string;
}

/** 单份上传结果（成功或失败）。 */
export type AssetUploadOutcome = AssetUploadSuccess | AssetUploadFailure;

/**
 * 批量上传结果（需求 11.3）。
 *
 * 单份失败被隔离、不中断整批；`succeeded` 仅含成功落库素材，
 * `failed` 含被隔离的失败份（含全部不符合项或存储失败原因）。
 */
export interface BatchUploadResult {
  /** 成功落库的素材结果集合（不受失败份影响，需求 11.3）。 */
  succeeded: AssetUploadSuccess[];
  /** 被隔离的失败份集合（不保留不完整素材，需求 11.3）。 */
  failed: AssetUploadFailure[];
}
