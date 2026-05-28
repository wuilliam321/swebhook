const consultaCodigoCommand = require('../../../src/commands/consultaCodigo');
const { commandQueue, processCommandQueue, isJobDuplicate } = require('../../../src/queue');
const { sendTelegramMessage } = require('../../../src/api/telegram');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');

describe('Command: Consulta Codigo', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/consulta_codigo',
            userCommand: '/consulta_codigo',
            botToken: 'token123',
            botName: 'testBot',
            isGroupChat: false,
            chatStates: {},
            req: { body: { message: { chat: { id: 123 } } } }
        };
        isJobDuplicate.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /consulta_codigo or WAITING_FOR_PRODUCT_CODE state', () => {
        expect(consultaCodigoCommand.canHandle('/consulta_codigo', null)).toBe(true);
        expect(consultaCodigoCommand.canHandle('', { state: 'WAITING_FOR_PRODUCT_CODE' })).toBe(true);
        expect(consultaCodigoCommand.canHandle('/other', null)).toBe(false);
    });

    test('execute Step 1: should set state and ask for product code', async () => {
        await consultaCodigoCommand.execute(context);

        expect(context.chatStates[123]).toEqual({
            state: 'WAITING_FOR_PRODUCT_CODE',
            botName: 'testBot',
            botToken: 'token123'
        });
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('ingresa el código del producto'), 'token123');
    });

    test('execute Step 2: should handle valid code input', async () => {
        context.userCommand = 'PROD123';
        context.chatStates[123] = { state: 'WAITING_FOR_PRODUCT_CODE', botToken: 'token123' };
        
        await consultaCodigoCommand.execute(context);

        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'product_lookup',
            code: 'PROD123',
            originalMessageText: 'PROD123'
        }));
        expect(context.chatStates[123]).toBeUndefined();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Consultando información del producto'), 'token123');
        expect(processCommandQueue).toHaveBeenCalled();
    });

    test('execute Step 2: should notify if job is duplicate', async () => {
        context.userCommand = 'PROD123';
        context.chatStates[123] = { state: 'WAITING_FOR_PRODUCT_CODE', botToken: 'token123' };
        isJobDuplicate.mockReturnValue(true);
        
        await consultaCodigoCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Ya hay una consulta para el producto'), 'token123');
    });
});
