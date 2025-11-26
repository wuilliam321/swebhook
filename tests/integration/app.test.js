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

describe('Integration Tests: /telegram endpoint', () => {
    const chatId = 12345;
    const token = 'TEST_TOKEN';

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear in-memory state
        for (const key in chatStates) delete chatStates[key];
        commandQueue.length = 0;
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
        expect(commandQueue.length).toBe(1);
        expect(commandQueue[0].jobType).toBe('gasto');
        expect(commandQueue[0].spending).toContain('100 lunch');
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
        expect(commandQueue.length).toBe(1);
        expect(commandQueue[0].jobType).toBe('report');
        expect(commandQueue[0].period).toBe('3');
    });
});
