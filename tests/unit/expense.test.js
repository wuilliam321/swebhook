jest.mock('../../src/config', () => ({ OPENAI_API_KEY: 'key', OPENAI_EXPENSE_MODEL: 'test', EXPENSE_TIMEZONE: 'America/Caracas' }));
const { validateExpense, questionFor } = require('../../src/expense');
const { nextExpenseRow } = require('../../src/api/sheetsExpenses');

describe('expense validation', () => {
    test('keeps USD only in its normalized draft', () => {
        const draft = { date: '2026-08-16', amount: 50, currency: 'USD', reason: 'Marketing', account: 'Zelle Wuilliam', description: 'Publicidad', exchangeRate: null };
        expect(validateExpense(draft)).toEqual([]);
        expect(draft.amount).toBe(50);
    });
    test('asks only missing account for bolivares', () => {
        const draft = { date: '2026-08-16', amount: 3000, currency: 'VES', reason: 'Condominio', description: 'Condominio' };
        expect(validateExpense(draft)).toEqual(['cuenta']);
        expect(questionFor('cuenta')).toContain('cuenta');
    });
    test('finds next row after last valid date', () => {
        expect(nextExpenseRow(['Fecha', '', '2026-08-10', '2026-08-11', '', ''])).toBe(5);
        expect(nextExpenseRow(['Fecha', '', 'formula'])).toBe(1);
    });
});
