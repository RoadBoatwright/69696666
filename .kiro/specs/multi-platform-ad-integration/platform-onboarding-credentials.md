# 三平台广告 API 接入资质清单

> 本文档汇总接入 Meta、Google Ads、TikTok 三个广告平台官方 Marketing/Ads API 所需的账号、凭据、审核与合规资质，作为系统部署前的「凭据准备」对照清单。系统本身的凭据管理器（需求 1、19）以配置化、可后填方式管理下述凭据，缺失时对应平台优雅降级。
>
> 调查时间：2026 年 6 月，正式申请前请以各平台官方最新文档复核（各平台政策与截止日期持续变化）。

---

## 一、Meta Marketing API（Facebook / Instagram / Messenger / WhatsApp）

| 类别 | 资质项 | 说明 |
|---|---|---|
| 账号主体 | Meta Business Manager（企业管理平台） | 作为父 BM，需完成**企业验证（Business Verification）**：提交营业执照、企业域名、对公信息 |
| 开发者 | Meta for Developers 开发者账号 + 创建 App（Business 类型） | — |
| 权限（scope） | `ads_management`、`ads_read`、`business_management`、`leads_retrieval`（线索回流）、`pages_read_engagement` | 通过 App Review 申请 |
| 访问等级 | Standard Access（标准访问） | 标准访问门槛：15 天内 ≥ 500 次调用、错误率 < 15% |
| 代客户授权 | System User Token + on-behalf-of | 规模化采用两层 Business Manager 结构（对应需求 2） |
| 应用审核 | App Review | 提交使用场景说明、录屏演示、隐私政策 URL |
| CTWA / WhatsApp | Embedded Signup v4 | 2026-10-15 前须从 v2/v3 迁移至 v4（硬性截止），支持 WhatsApp Business API 与 Click-to-WhatsApp（对应需求 28） |
| 合规 | 隐私政策、数据删除回调、平台广告政策 | EU 流量需 Consent Mode |

## 二、Google Ads API（含 YouTube / 搜索 / 展示 / 购物）

| 类别 | 资质项 | 说明 |
|---|---|---|
| 账号主体 | MCC 经理账号（Manager Account） | 客户账号挂其下；developer token 必须在 MCC 下申请（对应需求 3） |
| 开发者凭据 | Developer Token | 在 MCC 的 API Center 填写 API Access 申请表，需审核 |
| 云项目 | Google Cloud 项目 + 启用 Google Ads API | 一个云项目只能绑定一个 developer token |
| 授权 | OAuth 2.0（client ID / secret + refresh token）或 Service Account | 调用需 OAuth 凭据 + developer token；经理账号调用还需 `login-customer-id` 请求头 |
| 访问等级 | Test → Basic（1.5 万操作/天、1000 请求/天）→ Standard（无限操作） | 生产以 Basic 起步 |
| 广告主验证 | 广告主身份验证（Advertiser Verification） | 2026 年起需完成至少一个账户的广告主身份验证 |
| 安全 | Passkeys（通行密钥） | 2026-07-15 起敏感账户操作强制 passkey |
| 离线转化 | ConversionUploadService 准入 | 2026-06-15 起，未在 2025.12–2026.05 间使用过离线转化导入的开发者将被阻断，需提前接入（对应需求 30） |
| 令牌保活 | OAuth 令牌 90 天不调用会被禁用 | 系统需保活/监控（对应需求 3、5） |
| 合规 | Consent Mode v2、更新版服务条款（2026-07-01 生效） | EU 流量需同意模式 v2 |

## 三、TikTok Marketing API

| 类别 | 资质项 | 说明 |
|---|---|---|
| 账号主体 | TikTok Business Account + Business Center（建议以 Agency 代理商身份注册） | 普通账号需先转专业/商业账号才能用数据能力（对应需求 4） |
| 开发者 | TikTok for Business 开发者账号 + 创建 App | 提交 App 审核，约 3-7 天 |
| 凭据 | App ID + App Secret | 即 OAuth 的 client ID / secret |
| 代客户授权 | 每客户账户走 OAuth 2.0 单独授权（两步：先取授权码再换长期 access token + refresh token） | Business Center Agency 关系代管理 |
| 权限范围 | 广告管理、报表、线索、Pixel/Events 等 scope | 创建 App 时申请 |
| 数据能力 | 账号须为专业/商业账号 | — |

## 四、跨平台共性资质（三家都需）

- 公司营业执照 / 对公主体（企业验证用）
- 备案的企业域名 + 隐私政策页 URL（各平台审核必查）
- 数据删除 / 用户数据回调端点（合规要求）
- 各平台广告政策合规（禁限行业、落地页质量）

## 五、商机闭环相关外部依赖凭据

| 依赖 | 资质项 | 对应需求 |
|---|---|---|
| 底层生成式 AI | Google Gemini API Key（客户背调、AI 行业报告、买家画像、广告草案、创意生成） | 需求 34、35、36、37、29 |
| 跟进通道 | 企业 WhatsApp Business API 账号 | 需求 39 |
| CRM 跟进通道 | 目标 CRM 系统 API 凭据 | 需求 39 |

## 六、接入与审核门槛排序（建议申请顺序）

1. **Meta**（地基，门槛已降低，生态最成熟）
2. **TikTok**（差异化，审核较快 3-7 天）
3. **Google**（审核最硬，需 MCC + developer token 审核 + 广告主验证）
4. **LinkedIn**（第二期，Partner Program 门槛高，本期仅预留扩展位）

> 注：上述凭据均通过系统凭据管理器（需求 1）配置化后填；任一平台凭据未填入时该平台功能优雅降级为不可用，不影响其余平台（需求 1.4、1.5）。
