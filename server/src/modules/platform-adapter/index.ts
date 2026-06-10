/**
 * 平台适配器模块公共导出（组件 4，需求 8.9、6.3）。
 */
export * from './domain';
export { CredentialAdapterContext } from './credential-adapter-context';
export {
  MetaAdapter,
  normalizeMetaReviewStatus,
  META_REVIEW_STATUS_NORMALIZED,
} from './meta-adapter';
export type { MetaNormalizedReviewStatus } from './meta-adapter';
export {
  GoogleAdapter,
  normalizeGoogleReviewStatus,
  GOOGLE_REVIEW_STATUS_NORMALIZED,
} from './google-adapter';
export type { GoogleNormalizedReviewStatus } from './google-adapter';
export { LinkedInAdapter } from './linkedin.adapter';
export {
  TikTokAdapter,
  normalizeTikTokReviewStatus,
  TIKTOK_REVIEW_STATUS_NORMALIZED,
} from './tiktok-adapter';
export type { NormalizedReviewStatus } from './tiktok-adapter';
export { PlatformAdapterRegistry, PLATFORM_ADAPTERS } from './platform-adapter.registry';
export { PlatformAdapterModule } from './platform-adapter.module';
