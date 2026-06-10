import { CredentialManagerService } from './credential-manager.service';
import { CredentialRedactionInterceptor } from './credential-redaction.interceptor';

function makeManagerStub(secret: string): CredentialManagerService {
  return {
    redact: (text: string) => text.split(secret).join('****' + secret.slice(-4)),
  } as unknown as CredentialManagerService;
}

describe('CredentialRedactionInterceptor（需求 1.3、6.5）', () => {
  const secret = 'SUPERSECRET123';
  const interceptor = new CredentialRedactionInterceptor(makeManagerStub(secret));

  it('对嵌套对象中的字符串脱敏', () => {
    const result = interceptor.redactDeep({
      token: secret,
      nested: { list: [`prefix-${secret}-suffix`] },
      count: 7,
    }) as { token: string; nested: { list: string[] }; count: number };

    expect(result.token).not.toContain(secret);
    expect(result.nested.list[0]).not.toContain(secret);
    expect(result.count).toBe(7);
  });

  it('对数组顶层脱敏', () => {
    const result = interceptor.redactDeep([secret, 'safe']) as string[];
    expect(result[0]).not.toContain(secret);
    expect(result[1]).toBe('safe');
  });

  it('处理 null 与基本类型', () => {
    expect(interceptor.redactDeep(null)).toBeNull();
    expect(interceptor.redactDeep(42)).toBe(42);
    expect(interceptor.redactDeep(true)).toBe(true);
  });

  it('处理循环引用不抛错', () => {
    const obj: Record<string, unknown> = { token: secret };
    obj.self = obj;
    expect(() => interceptor.redactDeep(obj)).not.toThrow();
  });

  it('redactLogPayload 对日志负载脱敏（需求 6.5）', () => {
    const out = interceptor.redactLogPayload({ msg: `using ${secret}` }) as { msg: string };
    expect(out.msg).not.toContain(secret);
  });
});
