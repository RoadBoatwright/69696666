# Implementation Plan

> 平台代运营式多平台投流获客系统 — 实现计划

## Overview

技术栈：Node.js + TypeScript + NestJS + PostgreSQL + Redis/BullMQ + KMS + React。属性测试用 fast-check（最少 100 次迭代，注释 `// Feature: multi-platform-ad-integration, Property {编号}`）。

**真实服务原则（重要）**：所有外部依赖一律对接**真实服务**，不使用模拟数据或模拟服务——Meta / Google Ads / TikTok Marketing API、Google Gemini、WhatsApp/CRM 均通过各自官方 SDK/HTTP API 真实调用；API 密钥与凭据先以**占位符**配置（占位状态，后续由管理员填入真实值），凭据未填入时对应能力按需求 1/优雅降级标记「不可用」，而非以假数据顶替。单元/属性测试针对纯函数与领域逻辑；涉及外部 API 的集成测试以真实沙盒/测试账户或受控的契约测试进行，不以 mock 顶替业务实现。

任务按依赖顺序组织：基础设施 → 领域核心层 → 平台适配器 → 获客主线应用服务（5步法获客闭环）→ 效果看板与业务指标 → 前端 → 高级投放能力全集 → 集成。带 `*` 的为可选测试任务。

## Tasks

### 第一部分：基础与领域核心层

- [x] 1. 搭建 NestJS + TypeScript 工程骨架与基础设施连接
  - 工程初始化、模块化目录、ESLint/Prettier、fast-check 接入、PostgreSQL + Redis/BullMQ 连接与健康检查
  - _Requirements: 1.6, 6.1_

- [x] 2. 建立核心数据库 schema 与迁移
  - [x] 2.1 三级广告结构与定向/预算/素材表（CAMPAIGN 含 first_published_at、AD_GROUP 含版位字段、AD、TARGETING、BUDGET_SCHEDULE、ASSET、AD_ASSET、LEAD_FORM；子级父级外键非空）
    - _Requirements: 8.1, 11.1, 12.1, 14.1, 33.1_
  - [x] 2.2 凭据/授权/令牌与线索/商机/背调/跟进/指标/审核/审计表（PLATFORM_CREDENTIAL 含 gemini、TOKEN_RECORD、LEAD、CAMPAIGN_DRAFT 含 confirm_status、OPPORTUNITY 全字段、VERIFICATION_RESULT/VERIFIED_FIELD、FOLLOWUP_RECORD/LEVEL_CHANGE_RECORD/BUYER_REPLY_EVENT、METRIC/CONVERSION_*/REVIEW_STATUS/AUDIT_LOG；敏感字段加密列）
    - _Requirements: 1.2, 5.1, 6.1, 9.2, 14.5, 15.2, 16.2, 17.1, 21.9_

- [x] 3. 实现凭据管理器（组件 1）
  - [x] 3.1 凭据提交/校验/二态状态计算（含 Meta/Google/TikTok/Gemini 独立配置项）_Requirements: 1.1, 1.2, 1.6, 1.7_
  - [x]* 3.2 属性测试 Property 1 凭据配置状态等价 _Requirements: 1.1, 1.2_
  - [x]* 3.3 属性测试 Property 2 非法凭据被拒且状态不变 _Requirements: 1.7_
  - [x] 3.4 KMS 信封加密存储与无 KMS 降级 _Requirements: 1.2, 1.8, 6.1_
  - [x]* 3.5 属性测试 Property 4 凭据存储加密往返 _Requirements: 6.1_
  - [x] 3.6 useDecrypted 内存清理与 redact 脱敏 _Requirements: 6.2, 6.3, 6.4_
  - [x]* 3.7 属性测试 Property 3 脱敏不可逆出明文 _Requirements: 6.2, 6.5_
  - [x] 3.8 平台可用性隔离 + 日志/响应脱敏拦截器 _Requirements: 1.3, 1.4, 1.5, 6.5_
  - [x]* 3.9 属性测试 Property 5 平台功能可用性隔离 _Requirements: 1.4_

- [x] 4. 检查点 - 凭据管理器测试通过

- [x] 5. 实现账户授权中心（组件 2）
  - [x] 5.1 令牌状态机纯函数 evaluateTokenStatus _Requirements: 5.1, 5.3, 3.4_
  - [x]* 5.2 属性测试 Property 6 令牌状态机唯一性 _Requirements: 5.1, 5.3, 3.4_
  - [x] 5.3 即将过期预警与幂等发送 _Requirements: 5.2, 5.6_
  - [x]* 5.4 属性测试 Property 7 即将过期映射与预警幂等 _Requirements: 5.2_
  - [x] 5.5 令牌刷新/Google 保活/连续失败阈值停止 _Requirements: 5.4, 5.5, 4.3, 3.3, 3.4_
  - [x]* 5.6 属性测试 Property 8 刷新成功复位 _Requirements: 5.4, 4.3_
  - [x]* 5.7 属性测试 Property 9 连续失败阈值停止 _Requirements: 5.5_
  - [x]* 5.8 属性测试 Property 10 Google 保活区间 _Requirements: 3.3_
  - [x] 5.9 三平台代客户授权建立与撤销检测（Meta/Google/TikTok，真实平台授权 API）_Requirements: 2.1-2.7, 3.1-3.7, 4.1-4.6_
  - [x] 5.10 授权状态汇总视图 _Requirements: 5.7_

- [x] 6. 检查点 - 账户授权中心测试通过

- [x] 7. 实现权限服务 RBAC（组件 15）
  - [x] 7.1 三角色授权纯函数 authorize（管理员/投手/商家）_Requirements: 7.1, 7.2, 7.3_
  - [x]* 7.2 属性测试 Property 49 RBAC 授权决策 _Requirements: 7.1, 7.2, 7.3_
  - [x]* 7.3 属性测试 Property 50 越权拒绝无副作用/商机资产隔离 _Requirements: 7.4, 21.10_
  - [x] 7.4 数据隔离守卫、未认证处理、越权审计 _Requirements: 7.4, 7.5, 7.6_

- [x] 8. 实现统一广告模型层（组件 3）
  - [x] 8.1 三级结构领域模型与父级唯一 + LinkedIn 扩展位 _Requirements: 8.1, 8.9_
  - [x]* 8.2 属性测试 Property 11 三级父级唯一 _Requirements: 8.1_
  - [x] 8.3 统一↔原生字段映射表与往返映射 _Requirements: 8.4_
  - [x]* 8.4 属性测试 Property 12 映射往返一致 _Requirements: 8.4_
  - [x] 8.5 默认值应用与不适用标记 _Requirements: 8.5, 10.4_
  - [x]* 8.6 属性测试 Property 13 默认值与不适用标记 _Requirements: 8.5, 10.4_
  - [x] 8.7 映射校验失败分类错误 + 版位字段（自动/手动二选一）_Requirements: 8.7, 33.1, 33.4, 33.7_
  - [x]* 8.8 属性测试 Property 14 映射校验失败 _Requirements: 8.7, 10.7_
  - [x]* 8.9 属性测试 Property 51 广告版位配置二选一 _Requirements: 33.1, 33.4, 33.7_

- [x] 9. 检查点 - 领域核心层测试通过

### 第二部分：平台适配器

- [x] 10. 实现平台适配器（组件 4）
  - [x] 10.1 PlatformAdapter 接口 + AdapterContext + 注册工厂 _Requirements: 8.9, 6.3_
  - [x] 10.2 MetaAdapter 完整实现（真实 Meta Marketing API）_Requirements: 8.4, 10.3, 11.4, 13.1, 19.2, 20.1_
  - [x]* 10.3 MetaAdapter 集成测试（真实沙盒/契约测试）_Requirements: 13.1, 18.1, 20.1_
  - [x] 10.4 GoogleAdapter 完整实现（真实 Google Ads API）_Requirements: 8.4, 10.3, 11.4, 13.1, 19.2, 20.1_
  - [x]* 10.5 GoogleAdapter 集成测试（真实沙盒/契约测试）_Requirements: 13.1, 18.1, 20.1_
  - [x] 10.6 TikTokAdapter 完整实现（真实 TikTok Marketing API）_Requirements: 8.4, 10.3, 11.4, 13.1, 19.2, 20.1_
  - [x]* 10.7 TikTokAdapter 集成测试（真实沙盒/契约测试）_Requirements: 13.1, 18.1, 20.1_
  - [x] 10.8 LinkedInAdapter 第二期扩展位（NotImplementedException）_Requirements: 8.9, 34.1_

- [x] 11. 检查点 - 平台适配器测试通过

### 第三部分：核心主线应用服务（五步法获客闭环）

- [x] 12. 实现广告计划服务（组件 6）
  - [x] 12.1 三级 CRUD 与约束校验（父级不存在拒绝、必填缺失全集、名称 1-255、数量上限 5000）_Requirements: 8.2, 8.3, 8.6, 8.8_
  - [x]* 12.2 属性测试 Property 15/16/17（名称长度/父级不存在/数量上限）_Requirements: 8.2, 8.6, 8.8_
  - [x] 12.3 预算/出价/排期校验 _Requirements: 12.1-12.7_
  - [x]* 12.4 属性测试 Property 24/25/26/27（预算/日预算/排期/出价）_Requirements: 12.1, 12.3, 12.6, 12.7_
  - [x] 12.5 投放编排与状态机（30秒超时/重复拦截/非有效授权阻止/first_published_at 写入）_Requirements: 13.1-13.6_
  - [x]* 12.6 属性测试 Property 28/29（非有效授权阻止/提交中拒绝重复）_Requirements: 13.4, 13.6_
  - [x] 12.7 受众定向配置与校验（国家地区+行业+职位+年龄/性别/兴趣）_Requirements: 10.1-10.7_
  - [x] 12.9 排除/负向定向与高意向相似受众（滤除低意向人群、以高意向商机为种子扩展）_Requirements: 10.8, 10.9_
  - [x]* 12.8 属性测试 Property 20 受众取值域 _Requirements: 10.1_

- [x] 13. 实现素材服务（组件 7）
  - [x] 13.1 素材上传校验/复用/删除/单份失败隔离 _Requirements: 11.1-11.7_
  - [x]* 13.2 属性测试 Property 21 素材单份失败隔离 _Requirements: 11.3_
  - [x]* 13.3 属性测试 Property 22 素材约束与不符合项反馈 _Requirements: 11.1, 11.2_
  - [x]* 13.4 属性测试 Property 23 被引用素材不可删除 _Requirements: 11.7_

- [ ] 14. 实现 AI 辅助建广告引擎（组件 5，需求 9）
  - [-] 14.1 generateDraft 按画像生成多平台草案（合并旧知识库/行业报告/画像/草案；缺素材/画像维度返回缺失项；Gemini 凭据缺失降级）_Requirements: 9.2, 9.7, 9.8_
  - [-] 14.9 derivePersona 产品定位描述→AI 自动推导买家画像（来源标记）_Requirements: 9.1_
  - [-] 14.10 人工审核模式两级配置（全局默认+单商家覆盖）+ 全自动档自动确认/专家把关档置待确认 _Requirements: 9.3, 9.4_
  - [-] 14.2 canPublish 草案确认状态机 + confirm 驱动投放 _Requirements: 9.5, 9.6_
  - [ ]* 14.3 属性测试 Property 18 草案确认状态机（待确认不得投放）_Requirements: 9.5, 9.6_
  - [ ]* 14.4 属性测试 Property 19 获客方案缺失项完整反馈 _Requirements: 9.8_
  - [-] 14.5 投放优化建议与受限自动优化（MCP优先/官方API；上下限内应用；数据缺失不生成）_Requirements: 9.9-9.14_
  - [-] 14.11 以有效高意向商机为优化目标 + 相似扩展/低意向排除建议（预算优先分配给高意向占比高的受众/版位）_Requirements: 9.15, 9.16_
  - [ ]* 14.6 AI 辅助建广告 Gemini 集成测试（真实 Gemini API）_Requirements: 9.1, 9.2, 9.9_

- [ ] 15. 检查点 - 建广告与投放测试通过

- [ ] 16. 实现线索收集服务（组件 8，需求 14）
  - [-] 16.1 高门槛留资表单（公司名+姓名+电话+邮箱必填）+ 回流升格商机 + 去重 _Requirements: 14.1-14.8_
  - [-] 16.4 留资质量闸门（邮箱/电话格式校验、一次性邮箱与无效占位识别、机器人/批量反作弊、企业身份初判；低质量/疑似作弊不计入有效线索）_Requirements: 14.9-14.12_
  - [ ]* 16.2 属性测试 Property 30 留资高门槛必填校验 _Requirements: 14.4_
  - [ ]* 16.3 属性测试 Property 31 线索去重幂等保留最早 _Requirements: 14.7_

- [ ] 17. 实现 Gemini 背调服务（组件 9，需求 15）
  - [ ] 17.1 Gemini 凭据二态 + isAvailable + verify 落库 _Requirements: 15.1, 15.2_
  - [ ] 17.2 背调失败保留原始数据待重试 _Requirements: 15.4_
  - [ ] 17.3 mergeFields 冲突合并纯函数 _Requirements: 15.5_
  - [ ]* 17.4 Gemini 背调集成测试（真实 Gemini API）_Requirements: 15.2, 15.4_
  - [ ]* 17.5 属性测试 Property 35 凭据缺失降级仍存储商机 _Requirements: 15.3_
  - [ ]* 17.6 属性测试 Property 36 背调失败保留原始数据 _Requirements: 15.4_
  - [ ]* 17.7 属性测试 Property 37 冲突字段同时保留标待核实 _Requirements: 15.5_

- [ ] 18. 实现商机分级引擎（组件 10，需求 16）
  - [ ] 18.1 score/levelRank 纯函数 + listByLevel + recompute _Requirements: 16.1-16.6_
  - [ ]* 18.2 属性测试 Property 38 等级唯一性与取值域 _Requirements: 16.1, 16.2_
  - [ ]* 18.3 属性测试 Property 39 缺失置未分级记缺失项 _Requirements: 16.3_
  - [ ]* 18.4 属性测试 Property 40 排序单调性 _Requirements: 16.4_
  - [ ]* 18.5 属性测试 Property 41 重算覆盖并记录变更 _Requirements: 16.5, 16.6_

- [ ] 19. 实现跟进路由服务（组件 11，需求 17）
  - [ ] 19.1 nextStatus 状态机 + autoRoute/manualRoute + generatePlaybook + recordBuyerReply _Requirements: 17.1-17.7, 21.6_
  - [ ]* 19.2 WhatsApp/CRM 路由集成测试（真实通道沙盒）_Requirements: 17.3, 17.4, 17.6, 17.7_
  - [ ]* 19.3 属性测试 Property 42 跟进状态机综合不变量 _Requirements: 17.1, 17.3, 17.6, 17.7_

- [ ] 20. 检查点 - 商机闭环测试通过

- [ ] 21. 实现数据回传服务与审核同步（组件 12、13，需求 18、19、20）
  - [ ] 21.1 指标拉取/归一化/computeRoi/单平台失败隔离 _Requirements: 18.1-18.7_
  - [ ]* 21.2 属性测试 Property 32 ROI 与零花费 _Requirements: 18.2, 18.3_
  - [ ]* 21.3 属性测试 Property 33 单平台失败隔离 _Requirements: 18.7_
  - [ ] 21.4 转化追踪配置与事件关联/未匹配 _Requirements: 19.1-19.7_
  - [ ]* 21.5 属性测试 Property 34 转化关联/未匹配 _Requirements: 19.5, 19.6_
  - [ ] 21.6 审核状态同步归一化三态 + 变更通知 _Requirements: 20.1-20.5_

- [ ] 22. 实现异步调度接线（BullMQ）
  - 令牌保活/状态扫描、指标15min拉取、审核15min轮询、线索回流后触发背调、背调失败重试、分级重算、自动路由、跟进失败重试
  - _Requirements: 2.4, 5.2, 18.5, 20.1, 15.2, 16.5, 17.3, 17.7_

### 第四部分：效果看板与业务结果指标

- [ ] 23. 实现效果看板服务（组件 14，需求 21）
  - [ ] 23.1 聚合看板 + validateRange + 按平台/时间范围 + 缺失维度隔离 _Requirements: 21.1-21.4_
  - [ ]* 23.2 属性测试 Property 43 看板时间范围有效性与缺失隔离 _Requirements: 21.2, 21.3, 21.4_
  - [ ] 23.2 5 个业务指标纯函数（询盘成本/联络率/意向占比/投放时长/客户资产）_Requirements: 21.5, 21.6, 21.7, 21.8, 21.9_
  - [ ]* 23.3 属性测试 Property 44/45/46/47（询盘成本/联络率/占比/投放时长零除与边界）_Requirements: 21.5, 21.7, 21.8_
  - [ ]* 23.4 属性测试 Property 48 客户资产停投不丢失 _Requirements: 21.9_
  - [ ] 23.5 客户行业调查报告导出（维度缺失/AI凭据缺失标不可用）_Requirements: 21.11, 21.12_
  - [ ] 23.6 商机清单视图 + 筛选/排序（等级/平台/跟进状态/时间，L4优先）_Requirements: 21.13_
  - [ ] 23.7 单客户详情聚合（留资+质量标注+背调补全+等级轨迹+跟进剧本）_Requirements: 21.15_
  - [ ] 23.8 商机清单导出 Excel/CSV（空集生成仅表头、越权拒绝）_Requirements: 21.14, 21.16, 21.17_
  - [ ]* 23.9 属性测试 商机导出/详情 RBAC 数据隔离 _Requirements: 21.17_

- [ ] 24. 检查点 - 效果看板与指标测试通过

### 第五部分：前端（延后 —— 优先完成整个后端后再做）

> 说明：当前阶段**优先完成整个后端**，前端任务 25/26/27 全部延后，标记为可选（`*`），不纳入本轮执行调度。后端全部完成后再启动前端。

- [ ]* 25. 前端凭据配置与授权状态页（React，延后）_Requirements: 1.1, 1.7, 5.7, 7.5_
- [ ]* 26. 前端广告计划/草案确认/商机管理页（三级创建、草案确认、商机列表分级筛选、跟进，延后）_Requirements: 8.2, 9.2, 9.3, 10.1, 13.1, 16.4, 17.2_
- [ ]* 27. 前端效果看板与业务指标展示页 + 商机清单/单客户详情/一键导出 Excel-CSV + 行业调查报告导出（延后）_Requirements: 21.1, 21.5, 21.11, 21.13, 21.14, 21.15, 21.16_

### 第六部分：高级投放能力全集（本期实现）

- [ ] 28. 扩展能力调用网关框架 _Requirements: 22.1-22.6_
- [ ] 29. Meta Advantage+ 全自动系列 _Requirements: 23.1-23.5_
- [ ] 30. 商品目录与动态商品广告 _Requirements: 24.1-24.6_
- [ ] 31. Google Performance Max 系列 _Requirements: 25.1-25.4_
- [ ] 32. 智能出价策略全集 _Requirements: 26.1-26.4_
- [ ] 33. TikTok Spark Ads _Requirements: 27.1-27.4_
- [ ] 34. 统一 A/B 实验框架 _Requirements: 28.1-28.5_
- [ ] 35. 投前效果预估 _Requirements: 29.1-29.4_
- [ ] 36. 消息类广告 CTWA/CTM _Requirements: 30.1-30.5_
- [ ] 37. AI 创意生成 _Requirements: 31.1-31.5_
- [ ] 38. 离线/CRM 转化回传 _Requirements: 32.1-32.5_
- [ ] 39. 广告版位管理（手动版位完整实现，自动版位已在统一模型层）_Requirements: 33.2, 33.3, 33.5, 33.6_
- [ ] 40. LinkedIn B2B 扩展能力接口（第二期预留）_Requirements: 34.1-34.4_

### 第六部分之二：商机数据对外 API（供后续 CRM 接入）

- [ ] 40.1 商机数据对外 API：API 凭证签发/吊销 + 加密存储脱敏 _Requirements: 35.7, 35.8_
- [ ] 40.2 商机查询端点（分页 + updatedSince 增量 + 版本标识 + 限流）_Requirements: 35.1, 35.5, 35.6, 35.9, 35.10_
- [ ] 40.3 API 鉴权与商家数据隔离（无效/吊销凭证未认证、跨商家权限不足）_Requirements: 35.2, 35.3, 35.4_
- [ ]* 40.4 属性测试 商机数据对外 API 鉴权与数据隔离 _Requirements: 35.2, 35.4_

### 第七部分：最终集成

- [ ] 41. 最终集成与端到端装配
  - [ ] 41.1 全模块装配与依赖注入接线（含 LinkedIn 扩展位注册）_Requirements: 1.4, 8.9, 7.4_
  - [ ]* 41.2 端到端冒烟测试（无硬编码凭据、扩展位注册、模块装配）_Requirements: 1.6, 8.9_
  - [ ]* 41.3 调度周期与时间窗口集成测试（15分钟拉取/保活/回流/背调链路，对接真实服务沙盒）_Requirements: 5.2, 18.5, 20.1, 15.2_

- [ ] 42. 最终检查点 - 全量测试通过

## Notes

- 带 `*` 的子任务为可选测试任务（属性/集成/冒烟），核心实现子任务不可跳过。
- 属性测试用 fast-check，最少 100 次迭代，注释 `// Feature: multi-platform-ad-integration, Property {编号}`。
- **全部对接真实服务，不使用模拟数据或模拟服务**：Meta/Google/TikTok/LinkedIn 平台 API 与 Gemini、WhatsApp/CRM 均真实调用；API 密钥/凭据先以占位符配置，由管理员后续填入真实值；凭据未填入时按优雅降级标「不可用」，绝不以假数据顶替业务逻辑。
- 第六部分高级投放能力（任务 28-40）与获客主线同属本期实现，充分利用三平台官方 API 高级能力；其属性测试在实现时按 design 补充。仅 LinkedIn（任务 40）为第二期平台扩展位预留。
- 凭据/令牌/背调敏感字段绝不落明文；网络 API 经 JWT + RBAC 数据隔离，越权拒绝记审计。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "3.4", "3.6", "3.8", "5.1", "5.3", "5.5", "5.9", "5.10", "7.1", "7.4", "8.1", "8.3", "8.5", "8.7"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5", "3.7", "3.9", "5.2", "5.4", "5.6", "5.7", "5.8", "7.2", "7.3", "8.2", "8.4", "8.6", "8.8", "8.9"] },
    { "id": 4, "tasks": ["10.1", "10.2", "10.4", "10.6", "10.8"] },
    { "id": 5, "tasks": ["10.3", "10.5", "10.7", "12.1", "12.3", "12.5", "12.7", "12.9", "13.1"] },
    { "id": 6, "tasks": ["12.2", "12.4", "12.6", "12.8", "13.2", "13.3", "13.4", "14.1", "14.9", "14.10", "14.2", "14.5"] },
    { "id": 7, "tasks": ["14.3", "14.4", "14.6", "14.11", "16.1", "16.4", "21.1", "21.4", "21.6"] },
    { "id": 8, "tasks": ["16.2", "16.3", "17.1", "17.2", "17.3", "21.2", "21.3", "21.5"] },
    { "id": 9, "tasks": ["17.4", "17.5", "17.6", "17.7", "18.1", "19.1", "22"] },
    { "id": 10, "tasks": ["18.2", "18.3", "18.4", "18.5", "19.2", "19.3", "23.1", "23.2", "23.3", "23.4", "23.5", "23.6", "23.7", "23.8", "23.9"] },
    { "id": 11, "tasks": [] },
    { "id": 12, "tasks": ["28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "40.1", "40.2", "40.3", "40.4"] },
    { "id": 13, "tasks": ["41.1", "41.2", "41.3"] },
    { "id": 14, "tasks": ["42"] }
  ]
}
```

依赖关系说明：基础设施(1)→数据库(2)→凭据管理器(3)/授权中心(5)/权限(7)/统一模型(8)→平台适配器(10)→广告计划(12)/素材(13)→AI建广告(14)/线索(16)/数据回传(21)→背调(17)→分级(18)→跟进(19)→效果看板(23)→前端(25-27)；获客主线(1-27)与高级投放能力全集(28-40)均本期实现，最后做集成(41-42)。
