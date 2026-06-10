import { QUEUE_NAMES, REGISTERED_QUEUE_NAMES } from './queue.constants';

describe('queue 常量', () => {
  it('队列名应唯一，不存在重复', () => {
    const values = Object.values(QUEUE_NAMES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('已注册队列集合应均来自 QUEUE_NAMES 且无重复', () => {
    const known = new Set<string>(Object.values(QUEUE_NAMES));
    for (const name of REGISTERED_QUEUE_NAMES) {
      expect(known.has(name)).toBe(true);
    }
    expect(new Set(REGISTERED_QUEUE_NAMES).size).toBe(REGISTERED_QUEUE_NAMES.length);
  });
});
