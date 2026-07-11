import { Decimal } from 'decimal.js';
import type { SplitType } from '@prisma/client';
import { resolveSplits } from './money.util';

function sum(splits: { amountBase: Decimal }[]): Decimal {
  return splits.reduce((a, s) => a.plus(s.amountBase), new Decimal(0));
}

function input(userId: string, splitType: SplitType, shareValue: string) {
  return { userId, splitType, shareValue: new Decimal(shareValue) };
}

describe('resolveSplits, largest-remainder invariant', () => {
  it('equal split of an indivisible amount sums EXACTLY to the total', () => {
    const total = new Decimal('100');
    const r = resolveSplits(total, total, [
      input('a', 'equal', '0'),
      input('b', 'equal', '0'),
      input('c', 'equal', '0'),
    ]);
    expect(sum(r).equals(total)).toBe(true);
    // 100 / 3 → 33.333334 + 33.333333 + 33.333333
    const amounts = r.map((s) => s.amountBase.toString()).sort();
    expect(amounts).toEqual(['33.333333', '33.333333', '33.333334']);
  });

  it('equal split of 10 three ways sums exactly (classic rounding case)', () => {
    const total = new Decimal('10');
    const r = resolveSplits(total, total, [
      input('a', 'equal', '0'),
      input('b', 'equal', '0'),
      input('c', 'equal', '0'),
    ]);
    expect(sum(r).equals(total)).toBe(true);
  });

  it('shares split distributes proportionally and sums exactly', () => {
    const total = new Decimal('100');
    const r = resolveSplits(total, total, [
      input('a', 'shares', '1'),
      input('b', 'shares', '2'),
    ]);
    expect(sum(r).equals(total)).toBe(true);
    const map = Object.fromEntries(r.map((s) => [s.userId, s.amountBase.toString()]));
    expect(map.a).toBe('33.333333');
    expect(map.b).toBe('66.666667');
  });

  it('percent split must sum to 100 and resolves exactly', () => {
    const total = new Decimal('100');
    const r = resolveSplits(total, total, [
      input('a', 'percent', '33.33'),
      input('b', 'percent', '33.33'),
      input('c', 'percent', '33.34'),
    ]);
    expect(sum(r).equals(total)).toBe(true);
  });

  it('rejects percent that does not sum to 100', () => {
    const total = new Decimal('100');
    expect(() =>
      resolveSplits(total, total, [
        input('a', 'percent', '50'),
        input('b', 'percent', '40'),
      ]),
    ).toThrow();
  });

  it('exact split resolves against the frozen base total', () => {
    // 100 USD paid, converted to 90 EUR at rate 0.9.
    const amountOriginal = new Decimal('100');
    const amountBase = new Decimal('90');
    const r = resolveSplits(amountBase, amountOriginal, [
      input('a', 'exact', '30'),
      input('b', 'exact', '70'),
    ]);
    expect(sum(r).equals(amountBase)).toBe(true);
    const map = Object.fromEntries(r.map((s) => [s.userId, s.amountBase.toString()]));
    expect(map.a).toBe('27'); // 90 * 30/100
    expect(map.b).toBe('63'); // 90 * 70/100
  });

  it('rejects exact splits that do not sum to the original amount', () => {
    expect(() =>
      resolveSplits(new Decimal('90'), new Decimal('100'), [
        input('a', 'exact', '30'),
        input('b', 'exact', '60'), // sums to 90, not 100
      ]),
    ).toThrow();
  });

  it('rejects mixed split types in one transaction', () => {
    expect(() =>
      resolveSplits(new Decimal('100'), new Decimal('100'), [
        input('a', 'equal', '0'),
        input('b', 'shares', '1'),
      ]),
    ).toThrow();
  });

  it('rejects duplicate participants', () => {
    expect(() =>
      resolveSplits(new Decimal('100'), new Decimal('100'), [
        input('a', 'equal', '0'),
        input('a', 'equal', '0'),
      ]),
    ).toThrow();
  });

  it('property: random equal splits always sum exactly', () => {
    for (let t = 0; t < 200; t++) {
      const cents = 1 + Math.floor(Math.random() * 10_000_00); // up to 10k.00
      const total = new Decimal(cents).div(100);
      const n = 2 + Math.floor(Math.random() * 6);
      const splits = Array.from({ length: n }, (_, i) => input(`u${i}`, 'equal', '0'));
      const r = resolveSplits(total, total, splits);
      expect(sum(r).equals(total)).toBe(true);
    }
  });
});
