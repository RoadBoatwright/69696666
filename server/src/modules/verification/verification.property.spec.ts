import fc from 'fast-check';

import { VERIFIABLE_FIELDS, type VerifiableField } from './domain/verification';
import { mergeFields } from './pure';

const valueArb = fc.option(
  fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.trim()),
  {
    nil: undefined,
  },
);

const fieldMapArb = fc.tuple(...VERIFIABLE_FIELDS.map(() => valueArb)).map((values) => {
  const out: Partial<Record<VerifiableField, string>> = {};
  VERIFIABLE_FIELDS.forEach((f, i) => {
    const v = values[i];
    if (v !== undefined && v.length > 0) {
      out[f] = v;
    }
  });
  return out;
});

describe('背调字段合并纯函数属性（需求 15.5）', () => {
  // Feature: multi-platform-ad-integration, Property 35
  it('Property 35: 仅一侧有值的字段直接采用且无冲突', () => {
    fc.assert(
      fc.property(fieldMapArb, fieldMapArb, (original, verified) => {
        const merged = mergeFields(original, verified);
        for (const f of merged) {
          const o = original[f.field]?.trim();
          const v = verified[f.field]?.trim();
          if (o && !v) {
            expect(f).toMatchObject({ originalValue: o, conflict: false, needsReview: false });
            expect(f.verifiedValue).toBeUndefined();
          }
          if (!o && v) {
            expect(f).toMatchObject({ verifiedValue: v, conflict: false, needsReview: false });
            expect(f.originalValue).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 36
  it('Property 36: 双侧均无值的字段不产出条目；产出字段集为两侧有值字段的并集', () => {
    fc.assert(
      fc.property(fieldMapArb, fieldMapArb, (original, verified) => {
        const merged = mergeFields(original, verified);
        const expected = VERIFIABLE_FIELDS.filter(
          (f) => (original[f]?.trim() ?? '') !== '' || (verified[f]?.trim() ?? '') !== '',
        );
        expect(merged.map((f) => f.field)).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 37
  it('Property 37: 冲突字段同时保留两值并标待核实；一致字段不标冲突', () => {
    fc.assert(
      fc.property(fieldMapArb, fieldMapArb, (original, verified) => {
        const merged = mergeFields(original, verified);
        for (const f of merged) {
          const o = original[f.field]?.trim();
          const v = verified[f.field]?.trim();
          if (o && v) {
            if (o !== v) {
              expect(f).toEqual({
                field: f.field,
                originalValue: o,
                verifiedValue: v,
                conflict: true,
                needsReview: true,
              });
            } else {
              expect(f.conflict).toBe(false);
              expect(f.needsReview).toBe(false);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
