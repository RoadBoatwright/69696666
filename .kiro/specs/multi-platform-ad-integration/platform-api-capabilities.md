# 各平台广告 API 能力调查清单

> 本文档为「多平台广告投放接入系统」的技术支撑资料，调查 Meta、Google Ads、TikTok、LinkedIn 四个平台的官方 Marketing/Ads API 能力，作为统一广告对象模型与各平台适配器设计的依据。
>
> 调查时间：2026 年 6 月。各平台 API 版本与能力会持续更新，正式开发前需以官方最新文档复核。

---

## 一、总览对照表

| 能力维度 | Meta Marketing API | Google Ads API | TikTok Marketing API | LinkedIn Marketing API |
|---|---|---|---|---|
| 广告层级结构 | 系列 → 广告组(AdSet) → 广告 | 系列 → 广告组 → 广告/关键词 | 系列 → 广告组 → 广告(+创意) | 系列组 → 系列 → 创意 |
| 创建/管理广告 | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ 完整 |
| 受众定向 | ✅ 最丰富 | ✅ 关键词+受众 | ✅ 兴趣/行为/人群 | ✅ B2B 职业属性最强 |
| 自定义受众 | ✅ | ✅(客户匹配) | ✅ | ✅(企业名单上传) |
| 相似/预测受众 | ✅ Lookalike | ✅ Similar | ✅ Lookalike | ✅ Predictive Audiences |
| 素材上传 | ✅ 图/视频/轮播 | ✅ 多资产类型 | ✅ 视频为主 | ✅ 图/视频/文档 |
| 出价策略 | ✅ 多种 | ✅ 最丰富(智能出价) | ✅ 多种 | ✅ 多种 |
| 预算/排期 | ✅ 日/总预算 | ✅ | ✅ | ✅ |
| 实时数据/报表 | ✅ Insights API | ✅ 最详尽 | ✅ Reporting | ✅ Reporting |
| 转化追踪 | ✅ Pixel + CAPI | ✅ Conversion API | ✅ Pixel + Events API | ✅ Insight Tag + CAPI |
| 潜在客户表单(Lead) | ✅ Lead Ads | ✅ Lead Form 扩展 | ✅ Lead Generation | ✅ Lead Gen Forms(转化率翻倍) |
| A/B 测试 | ✅ | ✅ Experiments | ✅ Split Test API | 部分 |
| 官方 MCP 连接器 | ✅(2026.4 推出) | ❌ 暂无 | ❌ 暂无 | ❌ 暂无 |
| 接入难度 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 本期优先级 | 第 1（地基） | 第 3（审核最硬） | 第 2（差异化） | 第二期预留 |

---

## 二、Meta Marketing API（Facebook / Instagram / Messenger / WhatsApp）

**官方定位**：营销 API，覆盖 Meta 全家族版位。生态最成熟、文档最完善。

### 广告结构
- **三级结构**：Campaign（广告系列，承载投放目标）→ Ad Set（广告组，承载预算/排期/出价/定向）→ Ad（广告，承载创意素材）。
- 一个广告系列代表单一投放目标（如品牌认知、转化、线索），系列目标会对其下广告做校验约束。

### 受众定向（最丰富）
- 基础定向：地域、年龄、性别、语言。
- 详细定向：兴趣、行为、人口属性（可在一次请求中搜索多种定向类型并获取建议）。
- 自定义受众（Custom Audience）：基于客户名单（邮箱、电话、姓名、生日、性别、地理位置、App 用户 ID 等）构建。
- 相似受众（Lookalike Audience）：基于种子受众扩展相似人群。
- 广泛定向（Broad）：依赖投放系统自动找人。

### 素材
- 图片、视频、轮播（Carousel）、精选集（Collection）。

### 出价与预算
- 日预算 / 总预算（在广告组层级）。
- 多种出价方式（含 oCPM 优化）。

### 数据与转化
- Insights API：曝光、点击、转化、花费、ROI 等。
- 转化追踪：Pixel + Conversions API（CAPI，服务端回传）。

### 线索
- Lead Ads：广告内嵌潜在客户表单，买家提交后留资可通过 API 回流。

### 接入条件
- Meta Business Manager（作为父 BM）+ Developer App + 应用审核。
- 权限：`ads_management`、`ads_read`、`business_management`。
- 代客户：System User token + on-behalf-of；规模化用两层 BM。
- 标准访问门槛：15 天内 ≥ 500 次调用、错误率 < 15%。

### ⭐ 关键优势
- **唯一提供官方 MCP 连接器**（2026 年 4 月推出），可直接把广告户接入 AI 助手 → 我们「AI 优化广告计划」的官方通道。

---

## 三、Google Ads API（含 YouTube / 展示 / 搜索 / 购物）

**官方定位**：功能最强、覆盖广告类型最多，但复杂度最高。

### 广告结构
- Campaign（广告系列）→ Ad Group（广告组）→ Ad / Keyword（广告或关键词）。
- 广告类型：搜索广告、展示广告、YouTube 视频广告、购物广告、本地服务广告等。

### 受众定向
- 关键词定向（搜索广告核心）。
- 受众定向：兴趣、人群、再营销列表、年龄/性别、地理位置。
- 客户匹配（Customer Match，相当于自定义受众）、相似受众。

### 出价策略（最丰富，智能出价是强项）
- 目标 CPA、目标 ROAS、最大化转化、最大化转化价值、手动 CPC、ManualCpa 等。
- 提供出价策略推荐（建议预算 + 预测性能指标）。

### 素材
- 多资产类型（assets）：文字、图片、视频等组合。

### 数据与转化
- 报表最详尽：账户/系列/广告组/广告/关键词多层级，含曝光、点击、转化、花费等。
- 完整的转化管理工作流（Conversion Management）：可编程管理转化动作、上传离线转化。

### 线索
- Lead Form 扩展（搜索/展示广告附加潜在客户表单）。

### 接入条件
- **MCC（经理账号）** —— 客户账号挂其下。
- Google Cloud 项目 + OAuth 2.0（或 service account）。
- **Developer Token** 需审核；2026.2 起需完成至少一个账户的广告主身份验证。
- 三级访问：测试 → Basic（1.5 万操作/天、1000 请求/天）→ Standard（无限操作）。
- ⚠️ 令牌 90 天不调用会被禁用 → 需保活/监控（已在需求 3、5 体现）。

---

## 四、TikTok Marketing API

**官方定位**：增长最快，海外 B 端正在爆发；中文文档较完善。WÀ商机未接入 → 我方差异化点。

### 广告结构
- Campaign（推广系列）→ Ad Group（广告组）→ Ad（广告）。
- Smart+ 升级体验为四级：campaign → ad group → ad → creative。
- 单个 Ads Manager 账户最多支持 10,000 个 Spark Ads。

### 广告形式
- In-Feed Ads（信息流）、Spark Ads（加热原生视频）、Branded Content、TopView 等。
- Spark Ads 目前仅支持推广视频，不支持目录轮播。

### 受众定向
- 兴趣、行为、年龄、性别、地域、设备等。
- 自定义受众、相似受众（Lookalike）。

### 素材
- 视频为主，也支持图片。

### 数据与转化
- Reporting API：系列/广告组/创意层级性能指标。
- 转化追踪：TikTok Pixel + **Events API**（覆盖 web/app/线下 CRM 等渠道，可定制共享信息）。

### 独有能力
- **Split Test API**（A/B 测试）—— API-First 独家功能。

### 接入条件
- TikTok Business Account + Business Center（建议以 Agency 代理商身份注册）。
- 开发者账号 + 创建 App + 审核（约 3-7 天）。
- 每个客户账户走 OAuth 2.0 单独授权 → 长期 access token（两步：先取授权码，再换 token）。
- 普通账号需先转专业/商业账号才能用数据能力。

---

## 五、LinkedIn Marketing API（第二期预留）

**官方定位**：B2B 投放精准度最强。外贸 B2B 场景的「杀手锏」，对手完全没有。

### 广告结构
- Campaign Group（广告系列组）→ Campaign（广告系列）→ Creative（创意）。

### 受众定向（B2B 维度最强）
- **职业属性定向**：职位（job title）、公司、公司规模、行业、资历（seniority）、技能、教育。
- 地理位置、兴趣、设备类型/OS（2026 年新增设备定向）。
- 企业名单上传（Company List）+ 再营销（CRM 数据、网站访客、Lead 表单提交者）作为输入。
- **Predictive Audiences（预测受众）**：AI 找相似高意向人群，据报道可降低单条线索成本约 48%。

### 素材
- 图片、视频、文档（document ads）等。

### 数据与转化
- Reporting API：投放效果数据。
- 转化追踪：Insight Tag + Conversions API。

### 线索
- **Lead Gen Forms**：LinkedIn 称其转化率是普通落地页的两倍。

### 接入条件
- LinkedIn 开发者账号 + 创建 App。
- 加入 **LinkedIn Marketing Partner Program**（门槛高、审核慢）。
- 申请 Marketing Developer Platform 权限 + OAuth 2.0。

---

## 六、对系统设计的关键启示

1. **三级结构可统一抽象**：Meta/Google/TikTok 均为「系列→广告组→广告」三级；LinkedIn 为「系列组→系列→创意」。统一广告对象模型应以三级为主干，为 LinkedIn 的「系列组」层级预留映射弹性（对应需求 6 的扩展位）。

2. **定向维度差异大，需字段映射表**：
   - 三平台共有：地域、年龄、性别、兴趣、行为、自定义受众、相似受众。
   - LinkedIn 独有：职位/公司/行业/资历/技能（需求 8 已为其预留扩展位）。
   - 某平台不支持的维度要按需求 6/8 标记「不适用」。

3. **转化追踪机制各异但模式一致**：都是「像素/标签 + 服务端事件 API」双轨。统一抽象为「Pixel 配置 + 服务端事件回传」两类（对应需求 14）。

4. **线索表单是全平台共性**：四家都有原生 Lead Form 能力，线索回流是统一线索收集服务的核心（对应需求 12）。

5. **AI 优化优先走 Meta MCP**：目前仅 Meta 有官方 MCP 连接器，需求 15 的「MCP 优先、否则官方 API 直连」策略与现状吻合；其余平台先用官方 API 直连，待其推出 MCP 再切换。

6. **出价策略以 Google 最复杂**：统一模型的出价方式枚举需可扩展，适配器层做平台特定校验（对应需求 10 第 7 条「出价方式不受支持」的校验）。

7. **接入与审核门槛排序**：Meta（地基，门槛已降低）→ TikTok（差异化，审核快）→ Google（审核最硬，需 MCC + 广告主验证）→ LinkedIn（第二期，Partner Program 门槛高）。


---

# 附录 A：究极形态 —— 各平台完整 API 能力面（含高级/独有能力）

> 决策记录：用户选择「全部能力都要，追求究极形态」。本附录在前文「通用核心能力」之外，穷尽式列出各平台的高级与独有能力，作为统一层之上的「平台扩展能力包（Platform Extensions）」纳入需求与设计。
>
> 设计原则（重要）：通用能力进**统一广告对象模型**；平台独有/高级能力进各适配器的**平台扩展能力包**，按平台命名空间暴露，不强行塞入统一三级模型，避免模型臃肿。

## A.1 Meta 完整能力

### 系列类型与自动化
- **Advantage+ 系列**（Advantage+ Shopping / Advantage+ App / Advantage+ Audience）：Meta AI 全自动投放，Meta 主推。
- **Advantage+ Audience / Detailed Targeting**：定向建议（suggestions）+ 硬控制（hard controls：地域、语言、最低年龄、排除、特殊广告类别 Special Ad Category）。

### 动态与商品广告
- **Dynamic Ads（动态商品广告）** + **Catalog（商品目录）/ Product Set（商品集）**：机器学习按用户浏览行为动态选品展示。
- **Collection / Instant Experience（全屏即时体验）** 版位。

### 转化与测量
- **Conversions API（CAPI）**：服务端事件回传，含离线/CRM 转化，恢复 iOS 隐私限制下 30-40% 转化。
- **CAPI Gateway**、事件匹配质量（Event Match Quality）。
- **像素（Pixel）** + 自定义转化、转化价值。

### 投前预估与实验
- **Reach / Delivery Estimate（受众规模与触达预估）**：投放前预估询盘量/触达，差异化卖点。
- **A/B Test / Split Test** 实验框架。

### 消息类广告（外贸强相关）
- **Click-to-WhatsApp Ads（CTWA）**：点击广告直接打开 WhatsApp 会话并预填消息（v4 embedded signup 支持）。
- **Click-to-Messenger**、**Meta Business Agent**（企业级消息自动化）。

### 受众
- Custom Audience（客户名单/网站/App/互动）、Lookalike、Dynamic、Broad。

### 接入
- 官方 MCP 连接器（2026.4）；embedded signup v4（2026-10-15 前迁移，支持 WhatsApp API 与 CTWA）。

## A.2 Google Ads 完整能力

### 系列类型
- **Performance Max（PMax）**：Google AI 跨全版位（搜索/展示/YouTube/Gmail/地图/购物）自动投放，含 **Asset Group（资产组）**，支持生成式 AI 创建资产组。
- 搜索、展示、YouTube 视频、购物（Shopping）、本地服务、应用广告。

### 智能出价（全家桶）
- Target CPA、Target ROAS、Maximize Conversions、Maximize Conversion Value、Maximize Clicks、Manual CPC、ManualCpa。
- 出价策略推荐（建议预算 + 预测性能）。

### 购物与商品流
- **Merchant Center** 商品 feed + **Product Group（商品分组）** + 购物广告 / PMax 零售。

### 关键词与受众
- 关键词规划（Keyword Planner）、搜索词报告、否定关键词、close variants 匹配。
- 再营销列表 RLSA、客户匹配（Customer Match）、相似受众、按受众/人群/地域/年龄性别定向。

### 转化与测量
- 完整转化管理工作流、**离线转化上传**、转化价值规则、主/次转化框架（Primary/Secondary）。
- Reach Forecasting（ReachPlanService，需令牌单独 allowlist）。

### 实验
- Google Ads Experiments（A/B 实验）。

## A.3 TikTok 完整能力

### 系列与广告形式
- In-Feed Ads、**Spark Ads（加热原生视频，归因到自然帖，账户上限 10,000）**、Branded Content、TopView、品牌广告。
- **Smart+（全自动系列）**：campaign→ad group→ad→creative 四级结构。

### 创意与 AI
- **Symphony Creative Suite / Symphony API**：生成式 AI 创意生产、Recommended Creatives、动态创意补全与修复。
- Video Insights、创意洞察。

### 实验与定向
- **Split Test API**（独家 A/B 测试）。
- 兴趣/行为/年龄/性别/地域/设备定向、自定义受众、相似受众（Lookalike）。

### 商品与转化
- 商品目录（Catalog）/ 目录轮播、Video Shopping Ads。
- **Pixel + Events API**（web/app/线下 CRM 多渠道转化回传）。

## A.4 LinkedIn 完整能力（本期纳入扩展位，第二期实现）

### 系列结构
- Campaign Group → Campaign → Creative。

### B2B 定向（最强）
- 职位（job title）、公司、公司规模、行业、资历（seniority）、技能、教育、地理、兴趣、设备/OS（2026 新增）。

### 受众与 AI
- **Predictive Audiences（预测受众）**：AI 找相似高意向，降低单条线索成本约 48%。
- 企业名单上传（Company List）、CRM/网站访客/Lead 表单提交者作为再营销输入。

### 线索与测量
- **Lead Gen Forms**（转化率为普通落地页两倍）。
- Insight Tag + Conversions API、Reporting API。
- 广告形式：单图/视频/轮播/文档（Document Ads）等。

## A.5 究极形态对系统设计的增量影响

1. **新增「平台扩展能力包」分层**：统一层保持精简；每个适配器额外暴露 `PlatformExtensions` 命名空间（如 `meta.advantagePlus`、`meta.ctwa`、`google.performanceMax`、`google.smartBidding`、`tiktok.sparkAds`、`tiktok.splitTest`）。
2. **商品目录子系统（Catalog/Merchant Center）**：Meta Catalog、Google Merchant Center、TikTok Catalog 需统一的「商品流（Product Feed）」抽象 + 各平台同步适配。
3. **创意生成子系统**：对接 TikTok Symphony API、Google 生成式资产组、Meta 动态创意，统一「AI 创意生成」入口。
4. **投前预估能力**：Meta Reach Estimate、Google Reach Forecasting 抽象为统一「投前询盘量/触达预估」。
5. **消息类广告（CTWA/Click-to-Messenger）**：新增「消息广告」对象类型，承载预填消息、会话路由。
6. **实验框架**：Meta Split Test、Google Experiments、TikTok Split Test 抽象为统一「A/B 实验」能力。
7. **智能出价全集**：统一出价策略枚举需扩展为可承载 Target CPA/ROAS、Maximize 系列等，适配器按平台校验支持集。
8. **离线/CRM 转化回传**：Conversions API 离线转化、Google 离线转化上传，纳入统一转化追踪的「服务端/离线」通道。

> 注意：究极形态显著扩大工程量。建议在任务清单中按「统一核心（P0）→ 高价值扩展（P1：CTWA、智能出价、Spark Ads、投前预估、PMax/Advantage+）→ 长尾扩展（P2：商品目录、创意生成、实验框架、LinkedIn）」分阶段交付，但需求与设计先把完整能力面定义清楚。
