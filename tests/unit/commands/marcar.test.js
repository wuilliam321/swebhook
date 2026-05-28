const marcarCommand = require('../../../src/commands/marcar');
const { commandQueue, processCommandQueue } = require('../../../src/queue');
const { sendTelegramKeyboard, removeTelegramKeyboard } = require('../../../src/api/telegram');
const { getEmployeesByRole } = require('../../../src/api/firebase');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');
jest.mock('../../../src/api/firebase', () => ({
    getEmployeesByRole: jest.fn()
}));

describe('Command: Marcar', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        getEmployeesByRole.mockResolvedValue(['Ana', 'Maria']);
        context = {
            chatId: 123,
            userCommandRaw: '/marcar',
            userCommand: '/marcar',
            botToken: 'token123',
            botName: 'testBot',
            chatStates: {},
            req: {
                body: {
                    message: {
                        chat: { id: 123 },
                        text: '/marcar'
                    }
                }
            }
        };
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /marcar or related states', () => {
        expect(marcarCommand.canHandle('/marcar', null)).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_EMPLOYEE_NAME' })).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_STORE' })).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_ASISTENCIA_ACTION' })).toBe(true);
        expect(marcarCommand.canHandle('/other', null)).toBe(false);
    });

    test('Step 1: /marcar should set state and ask for name', async () => {
        await marcarCommand.execute(context);

        expect(context.chatStates[123]).toEqual({
            state: 'WAITING_FOR_EMPLOYEE_NAME',
            botName: 'testBot',
            botToken: 'token123'
        });
        expect(sendTelegramKeyboard).toHaveBeenCalledWith(
            123, 
            expect.stringContaining('¿Quién eres?'), 
            expect.any(Array), 
            'token123'
        );
    });

    test('Step 2: Name selected should update state and ask for store', async () => {
        context.userCommand = 'Ana';
        context.chatStates[123] = { state: 'WAITING_FOR_EMPLOYEE_NAME', botToken: 'token123' };
        
        await marcarCommand.execute(context);
        
        expect(context.chatStates[123].state).toBe('WAITING_FOR_STORE');
        expect(context.chatStates[123].nombre).toBe('Ana');
        expect(sendTelegramKeyboard).toHaveBeenCalledWith(
            123, 
            expect.stringContaining('tienda'), 
            expect.any(Array), 
            'token123'
        );
    });

    test('Step 3: Store selected should update state and ask for action', async () => {
        context.userCommand = 'Rodeo';
        context.chatStates[123] = { 
            state: 'WAITING_FOR_STORE', 
            nombre: 'Ana',
            botToken: 'token123' 
        };
        
        await marcarCommand.execute(context);
        
        expect(context.chatStates[123].state).toBe('WAITING_FOR_ASISTENCIA_ACTION');
        expect(context.chatStates[123].tienda).toBe('Rodeo');
        expect(sendTelegramKeyboard).toHaveBeenCalledWith(
            123, 
            expect.stringContaining('¿Qué acción vas a realizar?'), 
            expect.any(Array), 
            'token123'
        );
    });

    test('Step 4: Action selected should enqueue job, remove keyboard and clear state', async () => {
        context.userCommand = '☀️ Apertura';
        context.chatStates[123] = { 
            state: 'WAITING_FOR_ASISTENCIA_ACTION', 
            nombre: 'Ana',
            tienda: 'Rodeo',
            botToken: 'token123' 
        };
        
        await marcarCommand.execute(context);
        
        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'asistencia',
            nombre: 'Ana',
            tienda: 'Rodeo',
            accion: '☀️ Apertura',
            botToken: 'token123'
        }));
        expect(context.chatStates[123]).toBeUndefined();
        expect(removeTelegramKeyboard).toHaveBeenCalledWith(123, expect.any(String), 'token123');
        expect(processCommandQueue).toHaveBeenCalled();
    });
});
