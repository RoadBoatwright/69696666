import type { CredentialManagerService } from '../credential/credential-manager.service';
import { ExtensionGatewayService } from '../extension/extension-gateway.service';
import { ExperimentService } from './experiment.service';

function gatewayWith(status: 'filled' | 'unfilled'): ExtensionGatewayService {
  return new ExtensionGatewayService({
    getConfigStatus: async () => status,
  } as unknown as CredentialManagerService);
}

describe('ExperimentService（任务 34，需求 28）', () => {
  const meta = {
    createSplitTest: async () => ({ experimentId: 'exp-meta' }),
    getSplitTestResults: async () => [
      { name: 'A', results: {} },
      { name: 'B', results: {} },
    ],
  };
  const google = {
    createExperiment: async () => ({ experimentId: 'exp-google' }),
    getExperimentResults: async () => [{ name: 'arm-1' }, { name: 'arm-2' }],
  };
  const tiktok = {
    createSplitTest: async () => ({ experimentId: 'exp-tiktok' }),
    getSplitTestResults: async () => [{ split_test_group_name: 'g1' }, {}],
  };

  function build(status: 'filled' | 'unfilled' = 'filled') {
    return new ExperimentService(
      gatewayWith(status),
      meta as never,
      google as never,
      tiktok as never,
    );
  }

  it('分组少于两个 → 「实验分组数量不足」（需求 28.4）', async () => {
    const result = await build().createExperiment('meta', 'acct', '实验', [{}]);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.errors[0].reason).toBe('实验分组数量不足');
    }
  });

  it('三平台创建实验均返回实验标识（需求 28.1、28.2）', async () => {
    const service = build();
    for (const [platform, expected] of [
      ['meta', 'exp-meta'],
      ['google', 'exp-google'],
      ['tiktok', 'exp-tiktok'],
    ] as const) {
      const result = await service.createExperiment(platform, 'acct', '实验', [{}, {}]);
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.value.experimentId).toBe(expected);
      }
    }
  });

  it('结果按分组归一化（需求 28.3）', async () => {
    const result = await build().getResults('tiktok', 'acct', 'exp-tiktok');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.map((g) => g.group)).toEqual(['g1', 'group_2']);
    }
  });

  it('凭据未配置 → 经网关返回「该平台凭据未配置」', async () => {
    const result = await build('unfilled').createExperiment('meta', 'acct', '实验', [{}, {}]);
    expect(result.kind).toBe('unavailable');
  });
});
