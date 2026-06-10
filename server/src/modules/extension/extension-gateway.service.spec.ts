import type { CredentialManagerService } from '../credential/credential-manager.service';
import { ExtensionGatewayService } from './extension-gateway.service';

function gatewayWith(statuses: Record<string, 'filled' | 'unfilled'>): ExtensionGatewayService {
  const credentials = {
    getConfigStatus: async (key: string) => statuses[key] ?? 'unfilled',
  } as unknown as CredentialManagerService;
  return new ExtensionGatewayService(credentials);
}

describe('ExtensionGatewayService（任务 28，需求 22）', () => {
  it('能力支持范围可被查询（需求 22.1）', () => {
    const gateway = gatewayWith({});
    const capabilities = gateway.listCapabilities();
    expect(capabilities.advantage_plus).toEqual(['meta']);
    expect(capabilities.performance_max).toEqual(['google']);
    expect(capabilities.spark_ads).toEqual(['tiktok']);
  });

  it('支持且凭据已填入 → 执行并返回结果（需求 22.2）', async () => {
    const gateway = gatewayWith({ meta: 'filled' });
    const result = await gateway.invoke('advantage_plus', 'meta', async () => 'done');
    expect(result).toEqual({ kind: 'ok', value: 'done' });
  });

  it('平台不支持 → 「该平台不支持此能力」且不执行（需求 22.3、22.6）', async () => {
    const gateway = gatewayWith({ meta: 'filled' });
    let executed = false;
    const result = await gateway.invoke('performance_max', 'meta', async () => {
      executed = true;
      return 'x';
    });
    expect(executed).toBe(false);
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.error).toBe('该平台不支持此能力');
      expect(result.capability).toBe('performance_max');
      expect(result.platform).toBe('meta');
    }
  });

  it('凭据未填入 → 「该平台凭据未配置」，其余平台不受影响（需求 22.4）', async () => {
    const gateway = gatewayWith({ meta: 'unfilled', tiktok: 'filled' });
    const metaResult = await gateway.invoke('product_catalog', 'meta', async () => 'x');
    expect(metaResult.kind).toBe('unavailable');
    if (metaResult.kind === 'unavailable') {
      expect(metaResult.error).toBe('该平台凭据未配置');
    }
    const tiktokResult = await gateway.invoke('product_catalog', 'tiktok', async () => 'ok');
    expect(tiktokResult).toEqual({ kind: 'ok', value: 'ok' });
  });

  it('LinkedIn 调用 → 「该能力第二期提供」（需求 34.3）', async () => {
    const gateway = gatewayWith({});
    const result = await gateway.invoke('linkedin_b2b', 'linkedin', async () => 'x');
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.error).toBe('该能力第二期提供');
    }
  });
});
