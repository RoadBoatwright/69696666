import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

/**
 * 应用引导入口。
 *
 * 启动 NestJS 应用并从配置服务读取监听端口（来自环境变量，需求 1.6）。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const appConfig = configService.get<AppConfig>('app');
  const port = appConfig?.port ?? 3000;

  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
