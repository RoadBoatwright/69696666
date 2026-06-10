import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExtensionModule } from '../extension/extension.module';
import { CatalogService } from './catalog.service';
import { ProductFeed, ProductSet } from './entities';

/**
 * 商品流服务（任务 30，需求 24）。
 *
 * 统一商品流抽象（Meta Catalog / Google Merchant Center / TikTok Catalog）+ 商品集
 * + 动态商品广告关联；同步经扩展能力网关路由到各平台真实 API。
 */
@Module({
  imports: [TypeOrmModule.forFeature([ProductFeed, ProductSet]), ExtensionModule],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
