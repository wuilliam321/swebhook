const reportCommand = require('../../../src/commands/report');
const { commandQueue, processCommandQueue, isJobDuplicate } = require('../../../src/queue');
const { sendTelegramMessage } = require('../../../src/api/telegram');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');

describe('Command: Report', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/report',
            userCommand: '/report',
            botToken: 'token123',
            botName: 'testBot',
            chatStates: {},
            req: { body: { message: { chat: { id: 123 } } } }
        };
        isJobDuplicate.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /report or WAITING_FOR_REPORT_OPTION state', () => {
        expect(reportCommand.canHandle('/report', null)).toBe(true);
        expect(reportCommand.canHandle('', { state: 'WAITING_FOR_REPORT_OPTION' })).toBe(true);
        expect(reportCommand.canHandle('/other', null)).toBe(false);
    });

    test('execute Step 1: should set state and ask for period', async () => {
        await reportCommand.execute(context);

        expect(context.chatStates[123]).toEqual({
            state: 'WAITING_FOR_REPORT_OPTION',
            botName: 'testBot',
            botToken: 'token123'
        });
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('¿Qué período deseas para el reporte?'), 'token123');
    });

    test('execute Step 2: should handle valid option (3 - Month)', async () => {
        context.userCommand = '3';
        context.chatStates[123] = { state: 'WAITING_FOR_REPORT_OPTION', botToken: 'token123' };
        
        await reportCommand.execute(context);

        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'report',
            period: '3',
            originalMessageText: '/report 3'
        }));
        expect(context.chatStates[123]).toBeUndefined();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('generando tu reporte'), 'token123');
        expect(processCommandQueue).toHaveBeenCalled();
    });

    test('execute Step 2: should handle invalid option', async () => {
        context.userCommand = 'invalid';
        context.chatStates[123] = { state: 'WAITING_FOR_REPORT_OPTION', botToken: 'token123' };
        
        await reportCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(context.chatStates[123]).toBeDefined(); // State should remain
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('un número entre 0 y 6'), 'token123');
    });

    test('execute Step 2: should notify if job is duplicate', async () => {
        context.userCommand = '3';
        context.chatStates[123] = { state: 'WAITING_FOR_REPORT_OPTION', botToken: 'token123' };
        isJobDuplicate.mockReturnValue(true);
        
        await reportCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Ya hay una solicitud de reporte para este período'), 'token123');
    });
});
