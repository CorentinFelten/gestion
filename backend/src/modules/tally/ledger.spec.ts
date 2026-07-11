import { Decimal } from 'decimal.js';
import { Ledger, NULL_CATEGORY_KEY } from './ledger';

const GROCERIES = 'cat_groceries';
const A = 'alice';
const B = 'bob';
const C = 'carol';

function d(v: string | number): Decimal {
  return new Decimal(v);
}

describe('Ledger, pairwise per-category engine (§5.1)', () => {
  it('net_pair symmetry: net(u,v,c) === -net(v,u,c)', () => {
    const l = new Ledger();
    // Alice paid 90 groceries, split equally with Bob → Bob owes Alice 45.
    l.addOwe(B, A, GROCERIES, d(45));
    l.addOwe(A, A, GROCERIES, d(45)); // Alice's own share, ignored (self)

    expect(l.netCat(B, A, GROCERIES).toString()).toBe('45'); // Bob owes Alice
    expect(l.netCat(A, B, GROCERIES).toString()).toBe('-45');
    expect(l.netCat(B, A, GROCERIES).equals(l.netCat(A, B, GROCERIES).neg())).toBe(true);
  });

  it('self-owing splits are ignored (payer share creates no debt)', () => {
    const l = new Ledger();
    l.addOwe(A, A, GROCERIES, d(45));
    expect(l.netCat(A, A, GROCERIES).isZero()).toBe(true);
  });

  it('full reset zeroes the pair + category', () => {
    const l = new Ledger();
    l.addOwe(B, A, GROCERIES, d(45)); // Bob owes Alice 45
    // Bob reimburses Alice exactly 45 in groceries → net zero.
    l.addPaid(B, A, GROCERIES, d(45));
    expect(l.netCat(B, A, GROCERIES).isZero()).toBe(true);
    expect(l.netCat(A, B, GROCERIES).isZero()).toBe(true);
  });

  it('partial reimbursement reduces the pair by exactly the amount', () => {
    const l = new Ledger();
    l.addOwe(B, A, GROCERIES, d(45));
    l.addPaid(B, A, GROCERIES, d(20)); // partial
    expect(l.netCat(B, A, GROCERIES).toString()).toBe('25');
  });

  it('multi-currency settlements net correctly via their base amounts', () => {
    const l = new Ledger();
    l.addOwe(B, A, GROCERIES, d(45)); // Bob owes Alice 45 EUR
    // Two reimbursements paid in different currencies, each frozen to base EUR:
    l.addPaid(B, A, GROCERIES, d(20)); // e.g. 22.22 USD → 20 EUR
    l.addPaid(B, A, GROCERIES, d(25)); // e.g. 21.30 GBP → 25 EUR
    expect(l.netCat(B, A, GROCERIES).isZero()).toBe(true);
  });

  it('overall net sums across category buckets', () => {
    const l = new Ledger();
    l.addOwe(B, A, GROCERIES, d(45)); // Bob owes Alice 45 groceries
    l.addOwe(A, B, 'cat_rent', d(30)); // Alice owes Bob 30 rent
    // Overall: Bob owes Alice 45 - 30 = 15.
    expect(l.netOverall(B, A).toString()).toBe('15');
    expect(l.netOverall(A, B).toString()).toBe('-15');
  });

  it('null-category (overall) settlement lives in its own bucket', () => {
    const l = new Ledger();
    l.addOwe(B, A, GROCERIES, d(45));
    l.addPaid(B, A, NULL_CATEGORY_KEY, d(45)); // cross-category reimbursement
    // Per-category groceries still shows 45 owed...
    expect(l.netCat(B, A, GROCERIES).toString()).toBe('45');
    // ...but the overall position is cleared.
    expect(l.netOverall(B, A).isZero()).toBe(true);
  });

  it('three-member positions balance to zero (Σ everyone = 0)', () => {
    const l = new Ledger();
    l.addOwe(B, A, GROCERIES, d(30));
    l.addOwe(C, A, GROCERIES, d(30));
    l.addOwe(A, B, 'cat_rent', d(20));
    const balA = l.netOverall(B, A).plus(l.netOverall(C, A)); // owed to A
    const balB = l.netOverall(A, B).plus(l.netOverall(C, B));
    const balC = l.netOverall(A, C).plus(l.netOverall(B, C));
    expect(balA.plus(balB).plus(balC).isZero()).toBe(true);
  });
});
