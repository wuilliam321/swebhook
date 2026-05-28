const casheaAbonosCommand = require('../../../src/commands/casheaAbonos');
const { hasPendingCasheaAbonosJob, commandQueue, processCommandQueue } = require('../../../src/queue');
const { sendTelegramMessage } = require('../../../src/api/telegram');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');

describe('Command: Cashea Abonos', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/cashea_abonos',
            userCommand: '/cashea_abonos',
            botToken: 'token123',
            chatStates: {
                123: { state: 'SOME_STATE' }
            }
        };
        // Mock default behavior
        hasPendingCasheaAbonosJob.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for exactly /cashea_abonos', () => {
        expect(casheaAbonosCommand.canHandle('/cashea_abonos')).toBe(true);
        expect(casheaAbonosCommand.canHandle('/cashea_abonos_extra')).toBe(false);
        expect(casheaAbonosCommand.canHandle('/gasto')).toBe(false);
    });

    test('execute should push job and notify if not pending', async () => {
        await casheaAbonosCommand.execute(context);

        expect(hasPendingCasheaAbonosJob).toHaveBeenCalledWith('gilza');
        expect(commandQueue.push).toHaveBeenCalledWith({
            chatId: 123,
            account: 'gilza',
            originalMessageText: '/cashea_abonos',
            jobType: 'cashea_abonos',
            botToken: 'token123'
        });
        expect(context.chatStates[123]).toBeUndefined();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Consultando Cashea Abonos BNC'), 'token123');
        expect(processCommandQueue).toHaveBeenCalled();
    });

    test('execute should not push job and notify if job is already pending', async () => {
        hasPendingCasheaAbonosJob.mockReturnValue(true);

        await casheaAbonosCommand.execute(context);

        expect(commandQueue.push).not.toHaveBeenCalled();
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Ya hay una consulta de Cashea Abonos en proceso'), 'token123');
        expect(processCommandQueue).not.toHaveBeenCalled();
    });
});
