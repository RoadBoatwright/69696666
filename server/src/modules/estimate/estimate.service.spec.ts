import type { CredentialManagerService } from '../credential/credential-manager.service';
import { ExtensionGatewayService } from '../extension/extension-gateway.service';
import { EstimateService } from './estimate.service';

function gatewayWith(status: 'filled' | 'unfilled'): ExtensionGatewayService {
  return new ExtensionGatewayService({
    getConfigStatus: async () => status,
  } as unknown as CredentialManagerService);
}

describe('EstimateService（任务 35，需求 29）', () => {
  const meta = { reachEstimate: async () => ({ lowerBound: 1000, upperBound: 5000 }) };
  const google = { generateReachForecast: async () => ({ lowerBound: 2000, upperBound: 8000 }) };

  function build(status: 'filled' | 'unfilled' = 'filled') {
    return new EstimateService(gatewayWith(status), meta as never, google as never);
  }

  it('缺定向/预算 → 点名缺失项（需求 29.4）', async () => {
    const result = await build().estimate('meta', 'acct', undefined, undefined);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.errors.map((e) => e.field)).toEqual(['targeting', 'budget']);
    }
  });

  it('Meta/Google 归一化为统一触达与询盘区间（需求 29.2）', async () => {
    const result = await build().estimate('meta', 'acct', { geo: ['TH'] }, 100);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.reach).toEqual({ lowerBound: 1000, upperBound: 5000 });
      expect(result.value.inquiries.lowerBound).toBeLessThanOrEqual(
        result.value.inquiries.upperBound,
      );
      expect(result.value.inquiries.lowerBound).toBeGreaterThanOrEqual(0);
    }
  });

  it('TikTok 不支持 → 「该平台不支持此能力」（需求 29.3）', async () => {
    const result = await build().estimate('tiktok', 'acct', { geo: ['TH'] }, 100);
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.error).toBe('该平台不支持此能力');
    }
  });
});
