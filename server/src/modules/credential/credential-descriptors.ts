import { CredentialDescriptor, CredentialKey } from '../../common/domain/credential';

/**
 * 各凭据配置项必填项定义（需求 1.1、15.1）。
 *
 * 键名依据《三平台广告 API 接入资质清单》收敛为代客户授权与 API 调用所必需的最小集合；
 * Gemini 为底层生成式 AI（背调/建广告）凭据配置项（需求 15.1）。
 * 凭据值仅经配置接口提交，禁止硬编码（需求 1.6）。
 */
export const CREDENTIAL_DESCRIPTORS: Readonly<Record<CredentialKey, CredentialDescriptor>> = {
  // Meta：App 凭据 + System User Token（on-behalf-of 代管理）。
  meta: {
    key: 'meta',
    requiredKeys: ['appId', 'appSecret', 'systemUserToken', 'businessManagerId'],
  },
  // Google Ads：OAuth 客户端 + refresh token + developer token + MCC 经理账号。
  google: {
    key: 'google',
    requiredKeys: ['clientId', 'clientSecret', 'refreshToken', 'developerToken', 'loginCustomerId'],
  },
  // TikTok：App 凭据 + access/refresh token + Business Center。
  tiktok: {
    key: 'tiktok',
    requiredKeys: ['appId', 'appSecret', 'accessToken', 'refreshToken', 'businessCenterId'],
  },
  // Gemini：底层生成式 AI 的 API Key（需求 15.1）。
  gemini: {
    key: 'gemini',
    requiredKeys: ['apiKey'],
  },
};

/** 取得某凭据配置项的描述符（需求 1.1、15.1）。 */
export function getDescriptor(key: CredentialKey): CredentialDescriptor {
  return CREDENTIAL_DESCRIPTORS[key];
}
