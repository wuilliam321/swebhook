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
});
