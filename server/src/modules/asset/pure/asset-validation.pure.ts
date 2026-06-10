/**
 * 成品素材合规校验纯函数库（组件 7，需求 11.1、11.2）。
 *
 * 无副作用、仅依赖入参，使「文件大小上限」「轮播子素材数量」「格式/时长/尺寸平台合规」
 * 等不变量可被属性测试覆盖（Property 22）。校验返回 {@link AssetValidationError} 列表
 *（含字段名 + 原因分类 + 中文文案，需求 11.2），任一不符合项即拒绝且不存储（需求 11.2）。
 */
import {
  ASSET_TYPES,
  CAROUSEL_CHILDREN_MAX,
  CAROUSEL_CHILDREN_MIN,
  MAX_FILE_SIZE_BYTES,
  type AssetType,
  type AssetUploadInput,
  type AssetValidationError,
  type PlatformAssetSpec,
} from '../domain/asset';

/**
 * 校验单份成品素材上传输入，返回**全部**不符合项（需求 11.1、11.2，Property 22）。
 *
 * 校验顺序与覆盖项：
 *  1. 必填字段：merchantId / type / sizeBytes（需求 11.1）。
 *  2. 类型受支持：image | video | carousel | pdf（需求 11.1）。
 *  3. 文件大小：> 0 且 ≤ 系统上限 500MB；提供平台规格时还需 ≤ 平台上限（需求 11.1、11.2）。
 *  4. 轮播子素材数量：轮播类型必为 2-10（需求 11.1）。
 *  5. 平台合规（提供 spec 时）：格式、视频时长、尺寸（需求 11.2）。
 *
 * @param input 单份上传输入。
 * @param spec  目标平台对该素材类型的合规要求；未提供时仅做系统上限/类型/轮播校验。
 * @returns 全部不符合项；空数组表示通过校验。
 */
export function validateAssetUpload(
  input: AssetUploadInput,
  spec?: PlatformAssetSpec,
): AssetValidationError[] {
  const errors: AssetValidationError[] = [];

  // 1) 必填字段缺失（需求 11.1）。
  if (!isNonEmptyString(input.merchantId)) {
    errors.push({
      field: 'merchantId',
      code: 'required_missing',
      message: '商家标识为必填项',
    });
  }

  const typeValid = ASSET_TYPES.includes(input.type);
  if (input.type === undefined || input.type === null) {
    errors.push({ field: 'type', code: 'required_missing', message: '素材类型为必填项' });
  } else if (!typeValid) {
    // 2) 类型受支持（需求 11.1）。
    errors.push({
      field: 'type',
      code: 'type_unsupported',
      message: `素材类型需为 ${ASSET_TYPES.join('/')} 之一`,
    });
  }

  // 3) 文件大小（需求 11.1、11.2）。
  if (!Number.isFinite(input.sizeBytes)) {
    errors.push({ field: 'sizeBytes', code: 'required_missing', message: '文件大小为必填项' });
  } else if (input.sizeBytes <= 0) {
    errors.push({
      field: 'sizeBytes',
      code: 'size_exceeds_limit',
      message: '文件大小需大于 0',
    });
  } else {
    if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
      errors.push({
        field: 'sizeBytes',
        code: 'size_exceeds_limit',
        message: `单文件大小不得超过系统上限 ${formatMb(MAX_FILE_SIZE_BYTES)}`,
      });
    }
    if (spec && input.sizeBytes > spec.maxSizeBytes && spec.maxSizeBytes < MAX_FILE_SIZE_BYTES) {
      errors.push({
        field: 'sizeBytes',
        code: 'size_exceeds_limit',
        message: `单文件大小不得超过目标平台上限 ${formatMb(spec.maxSizeBytes)}`,
      });
    }
  }

  // 4) 轮播子素材数量（需求 11.1）。
  if (input.type === 'carousel') {
    const n = input.carouselChildren;
    if (
      n === undefined ||
      n === null ||
      !Number.isInteger(n) ||
      n < CAROUSEL_CHILDREN_MIN ||
      n > CAROUSEL_CHILDREN_MAX
    ) {
      errors.push({
        field: 'carouselChildren',
        code: 'carousel_children_out_of_range',
        message: `轮播子素材数量需为 ${CAROUSEL_CHILDREN_MIN}-${CAROUSEL_CHILDREN_MAX}`,
      });
    }
  }

  // 5) 平台合规：格式/时长/尺寸（需求 11.2）。
  if (spec && typeValid) {
    appendPlatformComplianceErrors(input, input.type, spec, errors);
  }

  return errors;
}

/** 追加平台合规不符合项（格式/时长/尺寸，需求 11.2）。 */
function appendPlatformComplianceErrors(
  input: AssetUploadInput,
  type: AssetType,
  spec: PlatformAssetSpec,
  errors: AssetValidationError[],
): void {
  // 格式：提供允许集合且素材声明了格式时校验。
  if (spec.allowedFormats.length > 0) {
    const fmt = typeof input.format === 'string' ? input.format.toLowerCase() : null;
    if (fmt === null || !spec.allowedFormats.includes(fmt)) {
      errors.push({
        field: 'format',
        code: 'format_unsupported',
        message: `文件格式需为 ${spec.allowedFormats.join('/')} 之一`,
      });
    }
  }

  // 时长：仅视频类型且平台声明了时长范围时校验。
  if (type === 'video' && (spec.minDurationSec != null || spec.maxDurationSec != null)) {
    const d = input.durationSec;
    const tooShort = spec.minDurationSec != null && d != null && d < spec.minDurationSec;
    const tooLong = spec.maxDurationSec != null && d != null && d > spec.maxDurationSec;
    const missing = d == null || !Number.isFinite(d);
    if (missing || tooShort || tooLong) {
      errors.push({
        field: 'durationSec',
        code: 'duration_out_of_range',
        message: durationMessage(spec),
      });
    }
  }

  // 尺寸：平台声明了尺寸约束时校验。
  if (
    spec.minWidth != null ||
    spec.minHeight != null ||
    spec.maxWidth != null ||
    spec.maxHeight != null
  ) {
    const w = input.width;
    const h = input.height;
    const widthBad =
      (spec.minWidth != null && (w == null || w < spec.minWidth)) ||
      (spec.maxWidth != null && w != null && w > spec.maxWidth);
    const heightBad =
      (spec.minHeight != null && (h == null || h < spec.minHeight)) ||
      (spec.maxHeight != null && h != null && h > spec.maxHeight);
    if (widthBad || heightBad) {
      errors.push({
        field: 'dimension',
        code: 'dimension_out_of_range',
        message: '素材尺寸不符合目标平台要求',
      });
    }
  }
}

function durationMessage(spec: PlatformAssetSpec): string {
  const lo = spec.minDurationSec != null ? `${spec.minDurationSec}` : '0';
  const hi = spec.maxDurationSec != null ? `${spec.maxDurationSec}` : '∞';
  return `视频时长需在 ${lo}-${hi} 秒之间`;
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** 是否为非空字符串。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
