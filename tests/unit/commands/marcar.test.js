const marcarCommand = require('../../../src/commands/marcar');
const { enqueueJob, processCommandQueue } = require('../../../src/queue');
const { sendTelegramKeyboard, removeTelegramKeyboard } = require('../../../src/api/telegram');
const { getReminders } = require('../../../src/api/firebase');
const { getEmployees } = require('../../../src/api/reimbursement');

jest.mock('../../../src/queue');
jest.mock('../../../src/api/telegram');
jest.mock('../../../src/api/firebase', () => ({
    getReminders: jest.fn()
}));
jest.mock('../../../src/api/reimbursement', () => ({ getEmployees: jest.fn() }));

describe('Command: Marcar', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        getEmployees.mockResolvedValue(['Ana', 'Maria']);
        getReminders.mockResolvedValue(['Cierre caja?', 'Cierre punto?']);
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
    });

    test('canHandle should return true for /marcar or related states', () => {
        expect(marcarCommand.canHandle('/marcar', null)).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_EMPLOYEE_NAME' })).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_STORE' })).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_ASISTENCIA_ACTION' })).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_OPENING' })).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_CLOSING' })).toBe(true);
        expect(marcarCommand.canHandle('', { state: 'WAITING_FOR_REMINDER_CONFIRMATION' })).toBe(true);
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
            [['Ana', 'Maria']],
            'token123'
        );
        expect(getEmployees).toHaveBeenCalledTimes(1);
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
            expect.stringContaining('¿Qué vas a registrar?'),
            [['☀️ Entrada', '🍽️ Inicia de Descanso'], ['🔙 Fin de Descanso', '🌙 Salida']],
            'token123'
        );
    });

    test('Step 4: Descanso should enqueue job immediately', async () => {
        context.userCommand = '🍽️ Inicia de Descanso';
        context.chatStates[123] = { 
            state: 'WAITING_FOR_ASISTENCIA_ACTION', 
            nombre: 'Ana',
            tienda: 'Rodeo',
            botToken: 'token123' 
        };
        
        await marcarCommand.execute(context);
        
        expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'asistencia',
            nombre: 'Ana',
            tienda: 'Rodeo',
            accion: '🍽️ Inicia de Descanso',
            reminders: ''
        }));
        expect(context.chatStates[123]).toBeUndefined();
    });

    test.each([
        ['☀️ Entrada', 'WAITING_FOR_OPENING', '✅ Sí', '✅ Entrada registrada\nAna · Rodeo\nApertura: Sí'],
        ['🌙 Salida', 'WAITING_FOR_CLOSING', '❌ No', '✅ Salida registrada\nAna · Rodeo\nCierre: No'],
        ['🍽️ Inicia de Descanso', 'WAITING_FOR_ASISTENCIA_ACTION', '🍽️ Inicia de Descanso', '✅ Inicio de descanso registrado\nAna · Rodeo'],
        ['🔙 Fin de Descanso', 'WAITING_FOR_ASISTENCIA_ACTION', '🔙 Fin de Descanso', '✅ Fin de descanso registrado\nAna · Rodeo']
    ])('resumen concreto para %s', async (accion, state, answer, expected) => {
        context.userCommand = answer;
        context.chatStates[123] = { state, accion, nombre: 'Ana', tienda: 'Rodeo', botToken: 'token123' };
        await marcarCommand.execute(context);
        const { attendanceSummary } = enqueueJob.mock.calls[0][0];
        expect(attendanceSummary).toContain(expected);
        expect(attendanceSummary).not.toContain('recordatorio');
        expect(attendanceSummary).toMatch(/\d{2}\/\d{2}\/\d{4}.*\d{2}:\d{2} \(Venezuela\)$/);
        expect(removeTelegramKeyboard).toHaveBeenCalledWith(123, '⏳ Guardando asistencia de Ana…', 'token123');
    });

    test('resumen de cierre incluye siete confirmaciones y fecha de Venezuela', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-03T02:40:00Z'));
        try {
            context.userCommand = '✅ Confirmo';
            context.chatStates[123] = {
                state: 'WAITING_FOR_REMINDER_CONFIRMATION', nombre: 'Maryory', tienda: 'History',
                accion: '🌙 Salida', closingAnswer: 'Cierra: Sí',
                pendingReminders: ['¿Ambientador desconectado?'],
                reminderAnswers: Array.from({ length: 6 }, (_, i) => `Recordatorio ${i}, Si, confirmo`)
            };
            await marcarCommand.execute(context);
            expect(enqueueJob.mock.calls[0][0].attendanceSummary).toBe(
                '✅ Salida registrada\nMaryory · History\nCierre: Sí\nConfirmó los 7 recordatorios.\n02/11/2026, 22:40 (Venezuela)'
            );
        } finally {
            jest.useRealTimers();
        }
    });

    test('Salida con cierre pide los recordatorios', async () => {
        context.userCommand = '🌙 Salida';
        context.chatStates[123] = { 
            state: 'WAITING_FOR_ASISTENCIA_ACTION', 
            nombre: 'Ana',
            tienda: 'Rodeo',
            botToken: 'token123' 
        };
        
        await marcarCommand.execute(context);

        expect(enqueueJob).not.toHaveBeenCalled();
        expect(getReminders).not.toHaveBeenCalled();
        expect(context.chatStates[123].state).toBe('WAITING_FOR_CLOSING');
        expect(sendTelegramKeyboard).toHaveBeenCalledWith(123, '¿Estás cerrando la tienda?', [['✅ Sí', '❌ No']], 'token123');

        context.userCommand = '✅ Sí';
        await marcarCommand.execute(context);

        expect(context.chatStates[123].state).toBe('WAITING_FOR_REMINDER_CONFIRMATION');
        expect(context.chatStates[123].closingAnswer).toBe('Cierra: Sí');
        expect(context.chatStates[123].pendingReminders).toEqual(['Cierre caja?', 'Cierre punto?']);
        expect(sendTelegramKeyboard).toHaveBeenCalledWith(
            123, 
            expect.stringContaining('Cierre caja?'), 
            [["✅ Confirmo", "❌ No"]],
            'token123'
        );
    });

    test('Entrada registra si abre sin consultar recordatorios', async () => {
        context.userCommand = '☀️ Entrada';
        context.chatStates[123] = { state: 'WAITING_FOR_ASISTENCIA_ACTION', nombre: 'Ana', tienda: 'Rodeo', botToken: 'token123' };
        await marcarCommand.execute(context);
        expect(context.chatStates[123].state).toBe('WAITING_FOR_OPENING');
        expect(sendTelegramKeyboard).toHaveBeenCalledWith(123, '¿Estás abriendo la tienda?', [['✅ Sí', '❌ No']], 'token123');

        context.userCommand = '✅ Sí';
        await marcarCommand.execute(context);
        expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ accion: '☀️ Entrada', reminders: 'Abre: Sí' }));
        expect(getReminders).not.toHaveBeenCalled();
    });

    test('Salida sin cierre registra salida sin recordatorios', async () => {
        context.userCommand = '🌙 Salida';
        context.chatStates[123] = { state: 'WAITING_FOR_ASISTENCIA_ACTION', nombre: 'Ana', tienda: 'Rodeo', botToken: 'token123' };
        await marcarCommand.execute(context);

        context.userCommand = '❌ No';
        await marcarCommand.execute(context);
        expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ accion: '🌙 Salida', reminders: 'Cierra: No' }));
        expect(getReminders).not.toHaveBeenCalled();
    });

    test('Step 5: No should be recorded and show next reminder', async () => {
        context.userCommand = '❌ No';
        context.chatStates[123] = { 
            state: 'WAITING_FOR_REMINDER_CONFIRMATION', 
            nombre: 'Ana',
            tienda: 'Rodeo',
            accion: '🌙 Salida',
            closingAnswer: 'Cierra: Sí',
            pendingReminders: ['Cierre caja?', 'Cierre punto?'],
            reminderAnswers: [],
            botToken: 'token123' 
        };
        
        await marcarCommand.execute(context);
        
        expect(context.chatStates[123].pendingReminders).toEqual(['Cierre punto?']);
        expect(context.chatStates[123].reminderAnswers).toEqual(['Cierre caja?, No, no confirmo']);
        expect(sendTelegramKeyboard).toHaveBeenCalledWith(
            123, 
            expect.stringContaining('Cierre punto?'), 
            [["✅ Confirmo", "❌ No"]],
            'token123'
        );
    });

    test('Step 5: Confirm last reminder should enqueue job', async () => {
        context.userCommand = '✅ Confirmo';
        context.chatStates[123] = { 
            state: 'WAITING_FOR_REMINDER_CONFIRMATION', 
            nombre: 'Ana',
            tienda: 'Rodeo',
            accion: '🌙 Salida',
            closingAnswer: 'Cierra: Sí',
            pendingReminders: ['Cierre punto?'], // Only one left
            reminderAnswers: ['Cierre caja?, No, no confirmo'],
            botToken: 'token123' 
        };
        
        await marcarCommand.execute(context);
        
        expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'asistencia',
            nombre: 'Ana',
            tienda: 'Rodeo',
            accion: '🌙 Salida',
            reminders: 'Cierra: Sí | Cierre caja?, No, no confirmo | Cierre punto?, Si, confirmo'
        }));
        const { attendanceSummary } = enqueueJob.mock.calls[0][0];
        expect(attendanceSummary).toContain('Recordatorios: 1 de 2 confirmados.');
        expect(attendanceSummary).toContain('⚠️ No confirmó: Cierre caja?');
        expect(attendanceSummary).not.toContain('Confirmó los 2 recordatorios.');
        expect(context.chatStates[123]).toBeUndefined();
    });
});
