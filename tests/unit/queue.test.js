const { processCommandQueue, commandQueue } = require('../../src/queue');
const { callSpendingAPI } = require('../../src/api/spending');
const { sendTelegramMessage } = require('../../src/api/telegram');

jest.mock('../../src/api/spending');
jest.mock('../../src/api/telegram');
jest.mock('../../src/api/pagoMovil');
jest.mock('../../src/api/inventory');
jest.mock('../../src/outfit');

describe('Unit Tests: Queue Processing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        commandQueue.length = 0;
    });

    test('should process gasto job successfully', async () => {
        const job = {
            chatId: 123,
            jobType: 'gasto',
            spending: '100 test',
            originalMessageText: '100 test'
        };
        commandQueue.push(job);

        callSpendingAPI.mockResolvedValue({ success: true, message: 'Recorded' });
        sendTelegramMessage.mockResolvedValue({ success: true });

        await processCommandQueue();

        expect(callSpendingAPI).toHaveBeenCalledWith('100 test', undefined);
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('registrado con éxito'), expect.any(String));
        expect(commandQueue.length).toBe(0);
    });

    test('should handle gasto job failure', async () => {
        const job = {
            chatId: 123,
            jobType: 'gasto',
            spending: 'fail',
            originalMessageText: 'fail'
        };
        commandQueue.push(job);

        callSpendingAPI.mockResolvedValue({ success: false, message: 'API Error' });

        await processCommandQueue();

        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Error registrando gasto'), expect.any(String));
    });

    test('should process deposito_lookup job successfully with code', async () => {
        const { callDepositoLookupAPI } = require('../../src/api/inventory');
        callDepositoLookupAPI.mockResolvedValue({ success: true, data: { Codigo: '123' } });

        const job = {
            chatId: 123,
            jobType: 'deposito_lookup',
            code: 'DEP123',
            group: null,
            originalMessageText: 'DEP123'
        };
        commandQueue.push(job);

        await processCommandQueue();

        expect(callDepositoLookupAPI).toHaveBeenCalledWith({ code: 'DEP123', group: null });
    });

    test('should process deposito_lookup job successfully with group', async () => {
        const { callDepositoLookupAPI } = require('../../src/api/inventory');
        callDepositoLookupAPI.mockResolvedValue({ success: true, data: { Grupo: 'Shirts' } });

        const job = {
            chatId: 123,
            jobType: 'deposito_lookup',
            code: null,
            group: 'Shirts',
            originalMessageText: 'group: Shirts'
        };
        commandQueue.push(job);

        await processCommandQueue();

        expect(callDepositoLookupAPI).toHaveBeenCalledWith({ code: null, group: 'Shirts' });
    });
});
