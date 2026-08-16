jest.mock('../../src/config', () => ({ OPENAI_API_KEY: 'key', OPENAI_EXPENSE_MODEL: 'test', EXPENSE_TIMEZONE: 'America/Caracas' }));
const { validateExpense, questionFor } = require('../../src/expense');
const { nextExpenseRow, isDateCell } = require('../../src/api/sheetsExpenses');

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
        const dateCell = date => ({ values: [{ userEnteredValue: { stringValue: date }, effectiveValue: { stringValue: date } }] });
        expect(nextExpenseRow([dateCell('2026-08-10'), dateCell('2026-08-11'), { values: [{ userEnteredValue: { formulaValue: '=TODAY()' }, effectiveValue: { numberValue: 46245 }, effectiveFormat: { numberFormat: { type: 'DATE' } } }] }, {}])).toBe(3);
        expect(isDateCell({ userEnteredValue: { formulaValue: '=TODAY()' }, effectiveValue: { numberValue: 46245 }, effectiveFormat: { numberFormat: { type: 'DATE' } } })).toBe(false);
        expect(nextExpenseRow([])).toBe(1);
    });
});
