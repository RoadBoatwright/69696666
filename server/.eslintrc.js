/**
 * ESLint 配置（@typescript-eslint + Prettier）。
 *
 * - 使用 @typescript-eslint 解析器与推荐规则，统一 TypeScript 代码规范。
 * - 通过 eslint-plugin-prettier 将 Prettier 作为 ESLint 规则运行，
 *   并以 eslint-config-prettier 关闭与 Prettier 冲突的格式化规则。
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2021,
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules', 'coverage'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    // 以下划线前缀标记的参数/变量为有意未使用（占位实现、接口契约形参），不报错。
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
};
