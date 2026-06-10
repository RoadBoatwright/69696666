import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlatformAdapterModule } from '../platform-adapter/platform-adapter.module';
import { AssetService } from './asset.service';
import { AdAsset } from './entities/ad-asset.entity';
import { Asset } from './entities/asset.entity';

/**
 * 素材服务（组件 7，需求 11）。
 *
 * 提供成品广告素材上传与平台合规校验（格式/尺寸/时长/文件大小）、单份失败隔离、
 * 复用/删除、被引用素材拒绝删除，以及经平台适配器挂载/引用至目标平台。
 *
 * 底层存储经 {@link './ports'.ASSET_STORAGE} 端口注入（生产环境绑定对象存储实现）；
 * 上传至平台经 {@link PlatformAdapterModule} 调用真实官方 API。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Asset, AdAsset]), PlatformAdapterModule],
  providers: [AssetService],
  exports: [AssetService],
})
export class AssetModule {}
