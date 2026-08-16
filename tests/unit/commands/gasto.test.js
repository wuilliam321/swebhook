const gastoCommand = require('../../../src/commands/gasto');
const { commandQueue, processCommandQueue, isJobDuplicate } = require('../../../src/queue');
const { sendTelegramMessage } = require('../../../src/api/telegram');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');

describe('Command: Gasto', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/gasto',
            userCommand: '/gasto',
            botToken: 'token123',
            botName: 'testBot',
            chatStates: {},
            req: {
                body: {
                    message: {
                        chat: { id: 123 },
                        from: { id: 999 }
                    }
                }
            }
        };
        isJobDuplicate.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /gasto or WAITING_FOR_AMOUNT state', () => {
        expect(gastoCommand.canHandle('/gasto', null)).toBe(true);
        expect(gastoCommand.canHandle('', { state: 'WAITING_FOR_AMOUNT' })).toBe(true);
        expect(gastoCommand.canHandle('/other', null)).toBe(false);
    });

    test('canHandle accepts store commands with inline expense text', () => {
        expect(gastoCommand.canHandle('/gasto_history 9999 bolivares de envio', null)).toBe(true);
        expect(gastoCommand.canHandle('/gastos_rodeo 50$ publicidad', null)).toBe(true);
    });

    test('groups quick selection options into two-column keyboard rows', () => {
        expect(gastoCommand.choiceKeyboard(['A', 'B', 'C'])).toEqual([['A', 'B'], ['C']]);
    });

    test('execute Step 1: should set state and ask for amount', async () => {
        await gastoCommand.execute(context);

        expect(context.chatStates[123]).toEqual({
            state: 'WAITING_FOR_AMOUNT',
            botName: 'testBot',
            botToken: 'token123'
        });
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('¿Cuánto gastaste y en qué?'), 'token123');
    });

    test('execute Step 2: should handle text input', async () => {
        context.userCommand = '100 lunch';
        context.chatStates[123] = { state: 'WAITING_FOR_AMOUNT', botToken: 'token123' };
        
        await gastoCommand.execute(context);

        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'gasto',
            spending: '100 lunch source:999'
        }));
        expect(context.chatStates[123]).toBeUndefined();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('encolado'), 'token123');
    });

    test('execute Step 2: should handle voice message', async () => {
        context.userCommand = '';
        context.chatStates[123] = { state: 'WAITING_FOR_AMOUNT', botToken: 'token123' };
        context.req.body.message.voice = { file_id: 'voice123' };

        await gastoCommand.execute(context);

        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'gasto',
            fileId: 'voice123',
            mediaType: 'voice'
        }));
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('multimedia recibido'), 'token123');
    });

    test('execute Step 2: should handle photo without caption (ask for text)', async () => {
        context.userCommand = '';
        context.chatStates[123] = { state: 'WAITING_FOR_AMOUNT', botToken: 'token123' };
        context.req.body.message.photo = [{ file_id: 'small' }, { file_id: 'large' }];

        await gastoCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(context.chatStates[123].pendingFileId).toBe('large');
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Foto recibida'), 'token123');
    });

    test('execute Step 2: should handle text following a photo', async () => {
        context.userCommand = '50 dinner';
        context.chatStates[123] = { 
            state: 'WAITING_FOR_AMOUNT', 
            botToken: 'token123',
            pendingFileId: 'large',
            pendingMediaType: 'photo'
        };

        await gastoCommand.execute(context);

        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            spending: '50 dinner source:999',
            fileId: 'large',
            mediaType: 'photo'
        }));
        expect(context.chatStates[123]).toBeUndefined();
    });
});
