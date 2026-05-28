const cierreCommand = require('../../../src/commands/cierre');
const { hasPendingCierreJob, commandQueue, processCommandQueue } = require('../../../src/queue');
const { sendTelegramMessage } = require('../../../src/api/telegram');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');

describe('Command: Cierre', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/cierre_wuilliam',
            userCommand: '/cierre_wuilliam',
            botToken: 'token123',
            isGroupChat: false,
            chatStates: {
                123: { state: 'SOME_STATE' }
            }
        };
        // Mock default behavior
        hasPendingCierreJob.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /cierre_ prefix', () => {
        expect(cierreCommand.canHandle('/cierre_wuilliam')).toBe(true);
        expect(cierreCommand.canHandle('/cierre_gilza')).toBe(true);
        expect(cierreCommand.canHandle('/gasto')).toBe(false);
    });

    test('execute should push job and notify if account is valid and not pending', async () => {
        await cierreCommand.execute(context);

        expect(hasPendingCierreJob).toHaveBeenCalledWith('wuilliam');
        expect(commandQueue.push).toHaveBeenCalledWith({
            chatId: 123,
            account: 'wuilliam',
            originalMessageText: '/cierre_wuilliam',
            jobType: 'cierre',
            botToken: 'token123',
            isGroupChat: false
        });
        expect(context.chatStates[123]).toBeUndefined();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Calculando cierre de PagoMóvil'), 'token123');
        expect(processCommandQueue).toHaveBeenCalled();
    });

    test('execute should not push job and notify if job is already pending', async () => {
        hasPendingCierreJob.mockReturnValue(true);

        await cierreCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Ya hay una solicitud de cierre para "wuilliam" en proceso'), 'token123');
        expect(processCommandQueue).not.toHaveBeenCalled();
    });
    
    test('execute should do nothing if account is invalid', async () => {
        context.userCommand = '/cierre_invalid';
        await cierreCommand.execute(context);

        expect(hasPendingCierreJob).not.toHaveBeenCalled();
        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).not.toHaveBeenCalled();
    });
});
