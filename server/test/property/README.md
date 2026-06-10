# 属性测试目录约定（test/property）

本目录统一存放基于 **fast-check** 的属性测试（Property-Based Testing, PBT）。

## 约定

1. **测试库**：使用 [fast-check](https://github.com/dubzzz/fast-check)，不自行实现属性测试框架。
2. **文件命名**：属性测试文件以 `*.property.spec.ts` 结尾，由 Jest（`testRegex: .*\.spec\.ts$`）自动识别。
3. **迭代次数**：每条正确性属性以**单个**属性测试实现，最少运行 **100 次**迭代。统一通过 `fc-config.ts` 导出的 `propertyConfig`（`numRuns: 100`）传入 `fc.assert`。
4. **属性标注**：每个属性测试以注释标注其对应的设计属性，格式为：

   ```ts
   // Feature: multi-platform-ad-integration, Property {编号}: {属性文本}
   ```

5. **需求关联**：在测试文件或用例中标注其验证的需求，格式为 `**Validates: Requirements X.Y**`。

## 示例

参见本目录下的 `example.property.spec.ts`，演示了上述全部约定（使用平凡纯函数作示例，不对应正式编号属性）。

## 运行

```bash
npm test            # 运行全部测试（含属性测试）
npm run lint        # 代码风格与静态检查
npm run format      # 使用 Prettier 统一格式化
```
