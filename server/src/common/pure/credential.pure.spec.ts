import type { CredentialDescriptor } from '../domain/credential';
import {
  computeConfigStatus,
  computeUnavailablePlatforms,
  isPlatformAvailable,
  isWellFormedCredentialValue,
  maskSecret,
  redact,
  validateCredentialValues,
} from './credential.pure';

const descriptor: CredentialDescriptor = {
  key: 'meta',
  requiredKeys: ['appId', 'appSecret'],
};

describe('validateCredentialValues（需求 1.7）', () => {
  it('全部必填项非空且合法时返回空错误集合', () => {
    expect(validateCredentialValues(descriptor, { appId: '123', appSecret: 'sekret' })).toEqual([]);
  });

  it('缺失必填项返回 missing', () => {
    expect(validateCredentialValues(descriptor, { appId: '123' })).toEqual([
      { key: 'appSecret', reason: 'missing' },
    ]);
  });

  it('空白值返回 empty', () => {
    expect(validateCredentialValues(descriptor, { appId: '123', appSecret: '   ' })).toEqual([
      { key: 'appSecret', reason: 'empty' },
    ]);
  });

  it('含控制字符返回 invalid_format', () => {
    expect(validateCredentialValues(descriptor, { appId: '123', appSecret: 'a\nb' })).toEqual([
      { key: 'appSecret', reason: 'invalid_format' },
    ]);
  });
});

describe('computeConfigStatus（需求 1.1）', () => {
  it('全部必填项通过校验时为 filled', () => {
    expect(computeConfigStatus(descriptor, { appId: '123', appSecret: 'sekret' })).toBe('filled');
  });

  it('任一必填项缺失/不合法时为 unfilled', () => {
    expect(computeConfigStatus(descriptor, { appId: '123' })).toBe('unfilled');
    expect(computeConfigStatus(descriptor, {})).toBe('unfilled');
  });

  it('无必填项的描述符恒为 unfilled', () => {
    expect(computeConfigStatus({ key: 'meta', requiredKeys: [] }, {})).toBe('unfilled');
  });
});

describe('maskSecret / redact（需求 6.2、1.3、6.5）', () => {
  it('长度 > 4 时仅暴露末 4 位', () => {
    expect(maskSecret('abcdefgh')).toBe('****efgh');
  });

  it('长度 <= 4 时完全脱敏', () => {
    expect(maskSecret('abcd')).toBe('****');
    expect(maskSecret('ab')).toBe('**');
  });

  it('redact 替换文本中出现的全部凭据明文', () => {
    const out = redact('token=SUPERSECRET123 done', ['SUPERSECRET123']);
    expect(out).not.toContain('SUPERSECRET123');
    // 暴露末 4 位（保留原大小写）。
    expect(out).toContain('T123');
  });

  it('redact 优先替换较长明文避免子串遗漏', () => {
    const out = redact('value=ABCDEFGH', ['ABCD', 'ABCDEFGH']);
    expect(out).not.toContain('ABCDEFGH');
  });

  it('无敏感值或空文本时原样返回', () => {
    expect(redact('hello', [])).toBe('hello');
    expect(redact('', ['x'])).toBe('');
  });
});

describe('isWellFormedCredentialValue', () => {
  it('普通可见字符合法', () => {
    expect(isWellFormedCredentialValue('abc-123_XYZ')).toBe(true);
  });
  it('含换行/制表/NUL 不合法', () => {
    expect(isWellFormedCredentialValue('a\nb')).toBe(false);
    expect(isWellFormedCredentialValue('a\tb')).toBe(false);
    expect(isWellFormedCredentialValue('a\u0000b')).toBe(false);
  });
});

describe('computeUnavailablePlatforms / isPlatformAvailable（需求 1.4）', () => {
  it('不可用集合恰好等于 unfilled 平台集合', () => {
    expect(
      computeUnavailablePlatforms({
        meta: 'filled',
        google: 'unfilled',
        tiktok: 'unfilled',
      }),
    ).toEqual(['google', 'tiktok']);
  });

  it('全部 filled 时不可用集合为空', () => {
    expect(
      computeUnavailablePlatforms({
        meta: 'filled',
        google: 'filled',
        tiktok: 'filled',
      }),
    ).toEqual([]);
  });

  it('isPlatformAvailable 当且仅当 filled', () => {
    expect(isPlatformAvailable('filled')).toBe(true);
    expect(isPlatformAvailable('unfilled')).toBe(false);
  });
});
