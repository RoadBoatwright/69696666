import type { Repository } from 'typeorm';

import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import type { CredentialManagerService } from '../credential/credential-manager.service';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { VerificationResult } from './entities/verification-result.entity';
import { VerifiedField } from './entities/verified-field.entity';
import { OpportunityNotFoundError, VerificationService } from './verification.service';
import type { GeminiVerifier } from './ports/gemini-verifier';
import type { GeminiVerificationOutput, RawLead } from './domain/verification';

/** 通用内存仓储桩。 */
function makeRepo<T extends object>(
  prefix: string,
): { repo: Repository<T>; store: Map<string, T> } {
  const store = new Map<string, T>();
  let seq = 0;
  const matches = (v: T, where: Partial<T>): boolean =>
    Object.entries(where).every(([k, val]) => (v as Record<string, unknown>)[k] === val);
  const recordKey = (e: T): string => {
    const rec = e as Record<string, unknown>;
    if (!rec.id) {
      rec.id = `${prefix}-${++seq}`;
    }
    return rec.id as string;
  };
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      const key = recordKey(e);
      store.set(key, { ...e });
      return store.get(key)!;
    },
    delete: async (where: Partial<T>) => {
      for (const [k, v] of [...store.entries()]) {
        if (matches(v, where)) store.delete(k);
      }
      return { affected: 1 };
    },
    findOne: async ({ where }: { where: Partial<T> }) => {
      for (const v of store.values()) {
        if (matches(v, where)) return { ...v };
      }
      return null;
    },
    find: async ({ where }: { where?: Partial<T> } = {}) => {
      const out: T[] = [];
      for (const v of store.values()) {
        if (!where || matches(v, where)) out.push({ ...v });
      }
      return out;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

const LEAD: RawLead = {
  companyName: 'Acme Trading Co',
  phone: '+66 2 123 4567',
  email: 'john@acme-trading.com',
  industry: '制造业',
  jobTitle: 'CEO',
};

const OUTPUT: GeminiVerificationOutput = {
  fields: { companyName: 'Acme Trading Co', industry: '机械制造', jobTitle: 'CEO' },
  credibilityScore: 82,
  summary: '企业信息基本可核实',
};

function setup(opts: { available?: boolean; verify?: GeminiVerifier['verify'] } = {}) {
  const result = makeRepo<VerificationResult>('vr');
  const field = makeRepo<VerifiedField>('vf');
  const opp = makeRepo<Opportunity>('opp');
  const available = opts.available ?? true;
  const credentials = {
    isGeminiAvailable: async () => available,
  } as unknown as CredentialManagerService;
  const gemini: GeminiVerifier = {
    verify:
      opts.verify ??
      (available
        ? async () => OUTPUT
        : async () => {
            throw new CredentialNotConfiguredError('gemini');
          }),
  };
  const service = new VerificationService(result.repo, field.repo, opp.repo, credentials, gemini);
  return { service, result, field, opp };
}

async function seedOpportunity(opp: { repo: Repository<Opportunity> }): Promise<Opportunity> {
  return opp.repo.save(
    opp.repo.create({
      leadId: 'lead-1',
      ownerMerchantId: 'm1',
      verificationStatus: '待背调',
    } as Partial<Opportunity>),
  );
}

describe('VerificationService（组件 9，需求 15）', () => {
  it('商机不存在抛 OpportunityNotFoundError', async () => {
    const { service } = setup();
    await expect(service.verify('nope', LEAD)).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });

  it('背调完成：落库结果与字段比对、冲突标待核实（需求 15.2、15.5）', async () => {
    const { service, opp, field } = setup();
    const o = await seedOpportunity(opp);
    const r = await service.verify(o.id, LEAD);
    expect(r.outcome).toBe('completed');
    if (r.outcome !== 'completed') return;
    const industry = r.fields.find((f) => f.field === 'industry');
    expect(industry).toEqual({
      field: 'industry',
      originalValue: '制造业',
      verifiedValue: '机械制造',
      conflict: true,
      needsReview: true,
    });
    expect((await opp.repo.findOne({ where: { id: o.id } }))!.verificationStatus).toBe('背调完成');
    expect(field.store.size).toBe(r.fields.length);
  });

  it('凭据缺失降级：标背调不可用、商机仍存储、不发起调用（需求 15.3）', async () => {
    let called = false;
    const { service, opp } = setup({
      available: false,
      verify: async () => {
        called = true;
        return OUTPUT;
      },
    });
    const o = await seedOpportunity(opp);
    const r = await service.verify(o.id, LEAD);
    expect(r.outcome).toBe('unavailable');
    expect(called).toBe(false);
    const stored = await opp.repo.findOne({ where: { id: o.id } });
    expect(stored).not.toBeNull();
    expect(stored!.verificationStatus).toBe('背调不可用');
  });

  it('调用失败：置背调失败并记录原因待重试（需求 15.4）', async () => {
    const { service, opp, result } = setup({
      verify: async () => {
        throw new Error('Gemini API 调用失败：HTTP 500');
      },
    });
    const o = await seedOpportunity(opp);
    const r = await service.verify(o.id, LEAD);
    expect(r).toMatchObject({ outcome: 'failed', reason: 'Gemini API 调用失败：HTTP 500' });
    const saved = [...result.store.values()][0];
    expect(saved.status).toBe('背调失败');
    expect(saved.failureReason).toContain('HTTP 500');
    expect((await opp.repo.findOne({ where: { id: o.id } }))!.verificationStatus).toBe('背调失败');
  });

  it('失败后重试成功覆盖为背调完成（需求 15.4）', async () => {
    let fail = true;
    const { service, opp } = setup({
      verify: async () => {
        if (fail) throw new Error('网络错误');
        return OUTPUT;
      },
    });
    const o = await seedOpportunity(opp);
    await service.verify(o.id, LEAD);
    fail = false;
    const r = await service.verify(o.id, LEAD);
    expect(r.outcome).toBe('completed');
    const stored = await service.getResult(o.id);
    expect(stored!.result.status).toBe('背调完成');
    expect(stored!.result.failureReason).toBeNull();
  });
});
