const depositoCommand = require('../../../src/commands/deposito');
const { commandQueue, processCommandQueue, isJobDuplicate } = require('../../../src/queue');
const { sendTelegramMessage } = require('../../../src/api/telegram');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');

describe('Command: Deposito', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/deposito',
            userCommand: '/deposito',
            botToken: 'token123',
            botName: 'testBot',
            isGroupChat: false,
            chatStates: {},
            req: { body: { message: { chat: { id: 123 } } } }
        };
        isJobDuplicate.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /deposito or WAITING_FOR_DEPOSITO_PRODUCT_CODE state', () => {
        expect(depositoCommand.canHandle('/deposito', null)).toBe(true);
        expect(depositoCommand.canHandle('', { state: 'WAITING_FOR_DEPOSITO_PRODUCT_CODE' })).toBe(true);
        expect(depositoCommand.canHandle('/other', null)).toBe(false);
    });

    test('execute Step 1: should set state and ask for product code', async () => {
        await depositoCommand.execute(context);

        expect(context.chatStates[123]).toEqual({
            state: 'WAITING_FOR_DEPOSITO_PRODUCT_CODE',
            botName: 'testBot',
            botToken: 'token123'
        });
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('ingresa el código del producto para consultar en depósito'), 'token123');
    });

    test('execute Step 2: should handle valid code input', async () => {
        context.userCommand = 'PROD123';
        context.chatStates[123] = { state: 'WAITING_FOR_DEPOSITO_PRODUCT_CODE', botToken: 'token123' };
        
        await depositoCommand.execute(context);

        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'deposito_lookup',
            code: 'PROD123',
            originalMessageText: 'PROD123'
        }));
        expect(context.chatStates[123]).toBeUndefined();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Consultando información de depósito'), 'token123');
        expect(processCommandQueue).toHaveBeenCalled();
    });

    test('execute Step 2: should notify if job is duplicate', async () => {
        context.userCommand = 'PROD123';
        context.chatStates[123] = { state: 'WAITING_FOR_DEPOSITO_PRODUCT_CODE', botToken: 'token123' };
        isJobDuplicate.mockReturnValue(true);
        
        await depositoCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Ya hay una consulta de depósito para el producto'), 'token123');
    });
});
