# 多平台广告投放与商机获客集成 — 后端服务

基于 Node.js + TypeScript + NestJS 的模块化后端工程。

## 技术栈

- **框架**：NestJS（模块化、依赖注入）
- **语言**：TypeScript（strict 模式）
- **数据库**：PostgreSQL（后续任务接入）
- **缓存/队列**：Redis + BullMQ（后续任务接入）
- **凭据加密**：KMS 信封加密，无 KMS 环境降级为本地 AES-256-GCM（后续任务接入）

## 目录结构

```
src/
├── main.ts                  # 应用引导入口
├── app.module.ts            # 根模块（装配 ConfigModule 与各业务模块）
├── config/
│   └── configuration.ts     # 环境变量加载（数据库/Redis/KMS）
├── common/                  # 跨模块共享
│   ├── common.module.ts
│   ├── domain/              # 平台无关领域类型
│   ├── pure/                # 纯函数库
│   ├── dto/                 # 数据传输对象
│   └── errors/              # 统一领域错误
└── modules/                 # 各业务能力模块
    ├── credential/          # 凭据管理器（组件 1）
    ├── auth-center/         # 账户授权中心（组件 2）
    ├── unified-model/       # 统一广告模型层（组件 3）
    ├── platform-adapter/    # 平台适配器（组件 4）
    ├── campaign/ asset/ lead/ metrics/ optimizer/ dashboard/ rbac/
    ├── extension/ catalog/ experiment/ estimate/ creative/
    ├── material-intake/ knowledge-base/ industry-report/
    ├── buyer-persona/ campaign-draft/
    └── lead-enrichment/ verification/ opportunity-scoring/
        followup-routing/ opportunity-dashboard/ benchmark/ industry-survey/
```

## 配置

复制 `.env.example` 为 `.env` 并填入真实值。凭据类配置项仅通过环境/配置接口注入，**禁止硬编码**（需求 1.6）。

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run build` | TypeScript 编译（nest build / tsc） |
| `npm run start` | 启动应用 |
| `npm run start:dev` | 监听模式启动 |
| `npm run test` | 运行测试 |
| `npm run lint` | ESLint 检查 |
| `npm run format` | Prettier 格式化 |
