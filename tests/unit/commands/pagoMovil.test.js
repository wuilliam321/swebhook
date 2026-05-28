const pagoMovilCommand = require('../../../src/commands/pagoMovil');
const { hasPendingPagoMovilJob, commandQueue, processCommandQueue } = require('../../../src/queue');
const { sendTelegramMessage } = require('../../../src/api/telegram');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');

describe('Command: Pago Movil', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/pagomovil_wuilliam',
            userCommand: '/pagomovil_wuilliam',
            botToken: 'token123',
            isGroupChat: false,
            chatStates: {
                123: { state: 'SOME_STATE' }
            }
        };
        // Mock default behavior
        hasPendingPagoMovilJob.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /pagomovil_ prefix', () => {
        expect(pagoMovilCommand.canHandle('/pagomovil_wuilliam')).toBe(true);
        expect(pagoMovilCommand.canHandle('/pagomovil_gilza')).toBe(true);
        expect(pagoMovilCommand.canHandle('/gasto')).toBe(false);
    });

    test('execute should push job and notify if account is valid and not pending', async () => {
        await pagoMovilCommand.execute(context);

        expect(hasPendingPagoMovilJob).toHaveBeenCalledWith('wuilliam');
        expect(commandQueue.push).toHaveBeenCalledWith({
            chatId: 123,
            account: 'wuilliam',
            originalMessageText: '/pagomovil_wuilliam',
            jobType: 'pagomovil',
            botToken: 'token123',
            isGroupChat: false
        });
        expect(context.chatStates[123]).toBeUndefined();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Consultando transacciones de PagoMóvil'), 'token123');
        expect(processCommandQueue).toHaveBeenCalled();
    });

    test('execute should not push job and notify if job is already pending', async () => {
        hasPendingPagoMovilJob.mockReturnValue(true);

        await pagoMovilCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Ya hay una consulta de PagoMóvil para "wuilliam" en proceso'), 'token123');
        expect(processCommandQueue).not.toHaveBeenCalled();
    });
    
    test('execute should do nothing if account is invalid', async () => {
        context.userCommand = '/pagomovil_invalid';
        await pagoMovilCommand.execute(context);

        expect(hasPendingPagoMovilJob).not.toHaveBeenCalled();
        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).not.toHaveBeenCalled();
    });
});
