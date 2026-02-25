const request = require('supertest');
const app = require('../../src/app');
const { chatStates } = require('../../src/state');
const { commandQueue } = require('../../src/queue');

// Mock dependencies
jest.mock('../../src/api/telegram');
jest.mock('../../src/api/spending');
jest.mock('../../src/api/pagoMovil');
jest.mock('../../src/api/inventory');
jest.mock('../../src/utils', () => ({
    ...jest.requireActual('../../src/utils'),
    runCommand: jest.fn(),
    runCommandAsync: jest.fn()
}));

const { sendTelegramMessage } = require('../../src/api/telegram');
const { callSpendingAPI } = require('../../src/api/spending');
const { callSalesReportAPI, callDepositoLookupAPI } = require('../../src/api/inventory');
const { callCierreAPI } = require('../../src/api/pagoMovil');

describe('Integration Tests: /telegram endpoint', () => {
    const chatId = 12345;
    const token = 'TEST_TOKEN';

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear in-memory state
        for (const key in chatStates) delete chatStates[key];
        commandQueue.length = 0;

        // Setup default mock implementations
        callSpendingAPI.mockResolvedValue({ success: true, message: 'Recorded' });
        callSalesReportAPI.mockResolvedValue({ success: true, data: 'Report data' });
        callCierreAPI.mockResolvedValue({ success: true, message: 'Cierre data' });
        if (callDepositoLookupAPI) {
             callDepositoLookupAPI.mockResolvedValue({ success: true, data: { Codigo: '123' } });
        }
    });

    test('POST /telegram - /cierre_wuilliam should queue cierre job', async () => {
        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: '/cierre_wuilliam'
                }
            });

        expect(response.status).toBe(200);
        expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Calculando cierre'), expect.any(String));
        
        // Job should be processed
        expect(commandQueue.length).toBe(0);
        expect(callCierreAPI).toHaveBeenCalledWith('wuilliam', false);
    });

    test('POST /telegram - /gasto command should ask for amount', async () => {
        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: '/gasto'
                }
            });

        expect(response.status).toBe(200);
        expect(chatStates[chatId]).toBeDefined();
        expect(chatStates[chatId].state).toBe('WAITING_FOR_AMOUNT');
        expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('¿Cuánto gastaste'), expect.any(String));
    });

    test('POST /telegram - /gasto amount input should queue job', async () => {
        // Setup state
        chatStates[chatId] = {
            state: 'WAITING_FOR_AMOUNT',
            botToken: token
        };

        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: '100 lunch',
                    from: { id: 999 }
                }
            });

        expect(response.status).toBe(200);
        expect(chatStates[chatId]).toBeUndefined(); // State should be cleared
        
        // The job is processed immediately by processCommandQueue (async background)
        // So it is removed from the queue.
        expect(commandQueue.length).toBe(0);
        
        // We can verify the processing happened
        expect(callSpendingAPI).toHaveBeenCalled();
        expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('encolado'), token);
    });

    test('POST /telegram - /report command should ask for period', async () => {
        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: '/report'
                }
            });

        expect(response.status).toBe(200);
        expect(chatStates[chatId].state).toBe('WAITING_FOR_REPORT_OPTION');
        expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('¿Qué período deseas'), expect.any(String));
    });

    test('POST /telegram - /report option should queue job', async () => {
        chatStates[chatId] = {
            state: 'WAITING_FOR_REPORT_OPTION',
            botToken: token
        };

        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: '3'
                }
            });

        expect(response.status).toBe(200);
        expect(commandQueue.length).toBe(0);
        expect(callSalesReportAPI).toHaveBeenCalledWith('3');
    });

    test('POST /telegram - /deposito command should ask for product code', async () => {
        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: '/deposito'
                }
            });

        expect(response.status).toBe(200);
        expect(chatStates[chatId].state).toBe('WAITING_FOR_DEPOSITO_PRODUCT_CODE');
        expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('ingresa el código'), expect.any(String));
    });

    test('POST /telegram - /deposito product code input should queue job', async () => {
        chatStates[chatId] = {
            state: 'WAITING_FOR_DEPOSITO_PRODUCT_CODE',
            botToken: token
        };

        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: 'DEP123'
                }
            });

        expect(response.status).toBe(200);
        
        // Job should be processed
        expect(commandQueue.length).toBe(0);
        if (callDepositoLookupAPI) {
            expect(callDepositoLookupAPI).toHaveBeenCalledWith('DEP123');
        }
    });

    test('POST /telegram - /gasto voice input should queue job with fileId', async () => {
        // Setup state
        chatStates[chatId] = {
            state: 'WAITING_FOR_AMOUNT',
            botToken: token
        };

        const response = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    voice: { file_id: 'voice_123' },
                    from: { id: 999 }
                }
            });

        expect(response.status).toBe(200);
        expect(chatStates[chatId]).toBeUndefined(); // State should be cleared
        
        // Verify callSpendingAPI was called with fileId
        expect(callSpendingAPI).toHaveBeenCalledWith(
            expect.stringContaining('source:999'), 
            undefined, 
            expect.objectContaining({ fileId: 'voice_123', mediaType: 'voice' })
        );
        expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Gasto multimedia recibido'), token);
    });

    test('POST /telegram - /gasto photo without caption should ask for text', async () => {
        // Setup state
        chatStates[chatId] = {
            state: 'WAITING_FOR_AMOUNT',
            botToken: token
        };

        // 1. Send photo without caption
        const response1 = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    photo: [{ file_id: 'photo_small' }, { file_id: 'photo_large' }],
                    from: { id: 999 }
                }
            });

        expect(response1.status).toBe(200);
        expect(chatStates[chatId].state).toBe('WAITING_FOR_AMOUNT'); // State persists
        expect(chatStates[chatId].pendingFileId).toBe('photo_large');
        expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Foto recibida'), token);

        // 2. Send text
        const response2 = await request(app)
            .post('/telegram')
            .send({
                message: {
                    chat: { id: chatId, type: 'private' },
                    text: '50 dinner',
                    from: { id: 999 }
                }
            });

        expect(response2.status).toBe(200);
        expect(chatStates[chatId]).toBeUndefined(); // State cleared
        
        // Verify job queued with combined info
        expect(callSpendingAPI).toHaveBeenCalledWith(
            expect.stringContaining('50 dinner'), 
            undefined, 
            expect.objectContaining({ fileId: 'photo_large', mediaType: 'photo' })
        );
    });
});
