/**
 * 素材服务外部依赖端口（组件 7，需求 11.1、11.3）。
 *
 * 将成品素材的底层存储（对象存储/外部托管）抽象为端口接口，使素材服务可在
 * 单元/属性测试中以桩注入，模拟网络中断/存储失败以验证单份失败隔离（需求 11.3）。
 */
import type { AssetUploadInput } from '../domain/asset';

/** DI 注入令牌：成品素材存储端口。 */
export const ASSET_STORAGE = Symbol('ASSET_STORAGE');

/** 存储成功结果：返回系统侧可访问的存储引用。 */
export interface AssetStorageResult {
  /** 系统侧存储引用（对象存储路径或外部托管引用）。 */
  storageRef: string;
}

/**
 * 成品素材存储端口（需求 11.1、11.3）。
 *
 * 实现负责将通过合规校验的成品素材写入底层存储；写入失败（网络中断/存储失败）
 * 抛出错误，由素材服务隔离该份、不保留不完整素材并继续处理其余份（需求 11.3）。
 */
export interface AssetStorage {
  /**
   * 存储单份成品素材，返回存储引用。
   *
   * @param assetId 系统生成的唯一素材标识。
   * @param input   已通过合规校验的上传输入。
   * @throws 当网络中断或存储失败时抛出错误（需求 11.3）。
   */
  store(assetId: string, input: AssetUploadInput): Promise<AssetStorageResult>;

  /**
   * 删除底层存储中的素材（用户删除自身素材时调用，需求 11.6）。
   *
   * @param storageRef 待删除素材的存储引用；为空时无操作。
   */
  remove(storageRef: string | null): Promise<void>;
}
