const { isJobDuplicate, commandQueue, processCommandQueue, hasPendingPagoMovilJob, hasPendingCierreJob } = require('../../src/queue');
const { callSpendingAPI } = require('../../src/api/spending');
const { sendTelegramMessage } = require('../../src/api/telegram');
const { callCierreAPI, callPagoMovilAPI } = require('../../src/api/pagoMovil');

jest.mock('../../src/api/spending');
jest.mock('../../src/api/telegram');
jest.mock('../../src/api/pagoMovil');
jest.mock('../../src/api/inventory');
jest.mock('../../src/outfit');

describe('Unit Tests: Queue Processing and Duplicate Detection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        commandQueue.length = 0;

        // Default mock implementations to avoid undefined.success errors
        callPagoMovilAPI.mockResolvedValue({ success: true, message: 'PagoMovil message' });
        callCierreAPI.mockResolvedValue({ success: true, message: 'Cierre message' });
        sendTelegramMessage.mockResolvedValue({ success: true });
    });

    test('should process cierre job successfully', async () => {
        const job = {
            chatId: 123,
            jobType: 'cierre',
            account: 'wuilliam',
            originalMessageText: '/cierre_wuilliam'
        };
        commandQueue.push(job);

        await processCommandQueue();

        expect(callCierreAPI).toHaveBeenCalledWith('wuilliam', undefined);
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Cierre de Caja'), expect.any(String));
        expect(commandQueue.length).toBe(0);
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

        expect(callSpendingAPI).toHaveBeenCalledWith('100 test', undefined, { fileId: undefined, mediaType: undefined });
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

    test('isJobDuplicate should identify duplicates in queue', () => {
        const job1 = { jobType: 'pagomovil', account: 'wuilliam' };
        const job2 = { jobType: 'pagomovil', account: 'wuilliam' };
        const job3 = { jobType: 'pagomovil', account: 'gilza' };

        commandQueue.push(job1);

        expect(isJobDuplicate(job2)).toBe(true);
        expect(isJobDuplicate(job3)).toBe(false);
    });

    test('isJobDuplicate should identify duplicate against currently processing job', async () => {
        let resolveSpending;
        const spendingPromise = new Promise(resolve => { resolveSpending = resolve; });
        callSpendingAPI.mockReturnValue(spendingPromise);

        const job1 = { jobType: 'gasto', spending: '100 lunch', fileId: '123' };
        const job2 = { jobType: 'gasto', spending: '100 lunch', fileId: '123' };

        commandQueue.push(job1);
        
        // Start processing without waiting for it to finish
        const processPromise = processCommandQueue();

        // Now job1 is "currentJob"
        expect(isJobDuplicate(job2)).toBe(true);

        // Finish processing
        resolveSpending({ success: true, message: 'Recorded' });
        await processPromise;

        // Now nothing is processing
        expect(isJobDuplicate(job2)).toBe(false);
    });

    test('hasPendingPagoMovilJob should distinguish between accounts', () => {
        commandQueue.push({ jobType: 'pagomovil', account: 'wuilliam' });

        expect(hasPendingPagoMovilJob('wuilliam')).toBe(true);
        expect(hasPendingPagoMovilJob('gilza')).toBe(false);
        expect(hasPendingPagoMovilJob()).toBe(true);
    });
});
