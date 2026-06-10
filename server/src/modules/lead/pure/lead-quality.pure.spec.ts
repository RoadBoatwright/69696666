import {
  assessBatchAntiFraud,
  assessLeadQuality,
  extractEmailDomain,
  isDisposableEmail,
  isPlaceholderValue,
  isValidEmailFormat,
  isValidPhoneFormat,
  judgeEnterpriseIdentity,
} from './lead-quality.pure';
import type { LeadSubmission } from '../domain/lead';

function sub(overrides: Partial<LeadSubmission> = {}): LeadSubmission {
  return {
    sourcePlatform: 'meta',
    platformLeadId: 'pl-1',
    collectedAt: new Date('2024-01-01T10:00:00Z'),
    companyName: 'Acme Trading Co',
    name: 'John Doe',
    phone: '+1 415 555 0132',
    email: 'john@acme-trading.com',
    ...overrides,
  };
}

describe('留资质量纯函数（需求 14.9-14.12）', () => {
  describe('邮箱格式校验（需求 14.9）', () => {
    it.each(['a@b.com', 'john.doe@acme-trading.co.uk', 'x+tag@sub.domain.io'])(
      '合法邮箱 %s',
      (email) => {
        expect(isValidEmailFormat(email)).toBe(true);
      },
    );

    it.each(['', 'no-at', 'a@b', 'a@@b.com', 'space d@b.com', null, undefined])(
      '非法邮箱 %s',
      (email) => {
        expect(isValidEmailFormat(email as string)).toBe(false);
      },
    );
  });

  describe('电话格式校验（需求 14.9）', () => {
    it.each(['+1 415 555 0132', '+8613800138000', '020-1234-5678'])('合法电话 %s', (p) => {
      expect(isValidPhoneFormat(p)).toBe(true);
    });

    it.each(['0000000000', '111', 'abcdefg', '', '12345678901234567890', null])(
      '非法/占位电话 %s',
      (p) => {
        expect(isValidPhoneFormat(p as string)).toBe(false);
      },
    );
  });

  describe('一次性邮箱与占位值识别（需求 14.9、14.10）', () => {
    it('识别一次性邮箱域名', () => {
      expect(isDisposableEmail('x@mailinator.com')).toBe(true);
      expect(isDisposableEmail('x@acme-trading.com')).toBe(false);
    });

    it('提取邮箱域名', () => {
      expect(extractEmailDomain('John@Acme.COM')).toBe('acme.com');
      expect(extractEmailDomain('invalid')).toBeNull();
    });

    it('识别占位值', () => {
      expect(isPlaceholderValue('test')).toBe(true);
      expect(isPlaceholderValue('aaaa')).toBe(true);
      expect(isPlaceholderValue('N/A')).toBe(true);
      expect(isPlaceholderValue('Acme Trading')).toBe(false);
    });
  });

  describe('企业身份初判（需求 14.12）', () => {
    it('企业域名+公司名 → 疑似真实企业', () => {
      expect(judgeEnterpriseIdentity({ companyName: 'Acme', email: 'a@acme.com' })).toBe(
        '疑似真实企业',
      );
    });

    it('免费邮箱 → 疑似个人/免费邮箱', () => {
      expect(judgeEnterpriseIdentity({ companyName: 'Acme', email: 'a@gmail.com' })).toBe(
        '疑似个人/免费邮箱',
      );
    });

    it('无公司名 → 疑似个人/免费邮箱', () => {
      expect(judgeEnterpriseIdentity({ companyName: '', email: 'a@acme.com' })).toBe(
        '疑似个人/免费邮箱',
      );
    });

    it('无邮箱 → 无法判定 null', () => {
      expect(judgeEnterpriseIdentity({ companyName: 'Acme', email: null })).toBeNull();
    });
  });

  describe('单条质量评估（需求 14.9、14.10、14.12）', () => {
    it('高质量留资通过且计入有效线索', () => {
      const q = assessLeadQuality(sub());
      expect(q.isValidLead).toBe(true);
      expect(q.qualityStatus).toBe('高质量');
      expect(q.flags).toHaveLength(0);
    });

    it('多项问题叠加多个标记', () => {
      const q = assessLeadQuality(sub({ email: 'bad', phone: '000' }));
      expect(q.isValidLead).toBe(false);
      expect(q.flags).toEqual(
        expect.arrayContaining(['email_format_invalid', 'phone_format_invalid']),
      );
    });
  });

  describe('批量反作弊（需求 14.11）', () => {
    it('同源短时高频提交命中 bot_high_frequency', () => {
      const base = Date.now();
      const submissions = Array.from({ length: 5 }, (_, i) =>
        sub({
          platformLeadId: `pl-${i}`,
          email: `b${i}@acme.com`,
          collectedAt: new Date(base + i * 1000),
        }),
      );
      const flags = assessBatchAntiFraud(submissions);
      expect(flags.every((f) => f.includes('bot_high_frequency'))).toBe(true);
    });

    it('低频不同内容不误判', () => {
      const submissions = [
        sub({ platformLeadId: 'a', email: 'a@acme.com', collectedAt: new Date('2024-01-01') }),
        sub({ platformLeadId: 'b', email: 'b@acme.com', collectedAt: new Date('2024-02-01') }),
      ];
      const flags = assessBatchAntiFraud(submissions);
      expect(flags.every((f) => f.length === 0)).toBe(true);
    });

    it('内容雷同命中 bot_duplicate_content', () => {
      const submissions = [
        sub({ platformLeadId: 'a', collectedAt: new Date('2024-01-01') }),
        sub({ platformLeadId: 'b', collectedAt: new Date('2024-03-01') }),
      ];
      const flags = assessBatchAntiFraud(submissions);
      expect(flags.every((f) => f.includes('bot_duplicate_content'))).toBe(true);
    });
  });
});
