import { TransactionFilterSchema } from '../modules/transactions/dto/transaction.dto';
import { SettlementFilterSchema } from '../modules/settlements/dto/settlement.dto';
import { PersonalTransactionFilterSchema } from '../modules/personal/personal.schemas';

/**
 * Query-string filters are validated at the boundary so a malformed date/enum
 * yields a 400 (via ZodValidationPipe) instead of reaching Prisma as an Invalid
 * Date and surfacing as a generic 500.
 */
describe('list-endpoint query filters', () => {
  describe('TransactionFilterSchema', () => {
    it('rejects a malformed `from` date', () => {
      expect(TransactionFilterSchema.safeParse({ from: 'abc' }).success).toBe(false);
    });

    it('accepts valid ISO dates and normalises the currency to upper-case', () => {
      const parsed = TransactionFilterSchema.parse({
        from: '2026-01-01',
        to: '2026-03-31',
        currency: 'usd',
        search: 'coffee',
      });
      expect(parsed.from).toBe('2026-01-01');
      expect(parsed.currency).toBe('USD');
    });

    it('accepts an empty filter', () => {
      expect(TransactionFilterSchema.parse({})).toEqual({});
    });
  });

  describe('SettlementFilterSchema', () => {
    it('accepts optional categoryId/memberId', () => {
      expect(SettlementFilterSchema.parse({ categoryId: 'c1' })).toEqual({ categoryId: 'c1' });
    });
  });

  describe('PersonalTransactionFilterSchema', () => {
    it('rejects a malformed `to` date', () => {
      expect(PersonalTransactionFilterSchema.safeParse({ to: '31-12-2026' }).success).toBe(false);
    });

    it('rejects an unknown transaction type', () => {
      expect(PersonalTransactionFilterSchema.safeParse({ type: 'bogus' }).success).toBe(false);
    });

    it('accepts a valid type + date range', () => {
      const parsed = PersonalTransactionFilterSchema.parse({
        type: 'expense',
        from: '2026-01-01',
      });
      expect(parsed.type).toBe('expense');
    });
  });
});
