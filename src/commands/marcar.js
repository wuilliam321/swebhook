const { commandQueue, processCommandQueue } = require('../queue');
const { sendTelegramKeyboard, removeTelegramKeyboard } = require('../api/telegram');
const { getEmployeesByRole } = require('../api/firebase');

const STORES = [
    ["Rodeo", "History"],
    ["Evento Externo"]
];

const ACTIONS = [
    ["☀️ Apertura", "🍽️ Ir a comer"],
    ["🔙 Volver de comer", "🌙 Cierre"]
];

/**
 * Utility to chunk an array into rows for Telegram keyboard.
 */
function chunkArray(array, size) {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
}

/**
 * Command to handle employee attendance marking.
 * Flow: /marcar -> Select Name -> Select Store -> Select Action
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand, chatState) => {
        return userCommand === "/marcar" || 
               (chatState && [
                   "WAITING_FOR_EMPLOYEE_NAME", 
                   "WAITING_FOR_STORE", 
                   "WAITING_FOR_ASISTENCIA_ACTION"
               ].includes(chatState.state)) || 
               false;
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommand, botToken, chatStates, botName } = context;
        const chatState = chatStates[chatId];

        // --- Step 1: Initial Command ---
        if (userCommand === "/marcar") {
            const employees = await getEmployeesByRole('employee');
            
            if (employees.length === 0) {
                const { sendTelegramMessage } = require('../api/telegram');
                await sendTelegramMessage(chatId, "⚠️ No se encontraron empleadas registradas en el sistema.", botToken);
                return;
            }

            const employeeKeyboard = chunkArray(employees, 2);

            chatStates[chatId] = {
                state: "WAITING_FOR_EMPLOYEE_NAME",
                botName: botName,
                botToken: botToken
            };
            await sendTelegramKeyboard(chatId, "👋 ¡Hola! Vamos a registrar tu asistencia. ¿Quién eres?", employeeKeyboard, botToken);
            return;
        }

        if (!chatState) return;
        const storedBotToken = chatState.botToken || botToken;

        // --- Step 2: Employee Selection ---
        if (chatState.state === "WAITING_FOR_EMPLOYEE_NAME") {
            chatState.nombre = userCommand;
            chatState.state = "WAITING_FOR_STORE";
            await sendTelegramKeyboard(chatId, `📍 Entendido, ${userCommand}. ¿En qué tienda estás hoy?`, STORES, storedBotToken);
            return;
        }

        // --- Step 3: Store Selection ---
        if (chatState.state === "WAITING_FOR_STORE") {
            chatState.tienda = userCommand;
            chatState.state = "WAITING_FOR_ASISTENCIA_ACTION";
            await sendTelegramKeyboard(chatId, "📝 ¿Qué acción vas a realizar?", ACTIONS, storedBotToken);
            return;
        }

        // --- Step 4: Action Selection ---
        if (chatState.state === "WAITING_FOR_ASISTENCIA_ACTION") {
            const { nombre, tienda } = chatState;
            const accion = userCommand;

            const job = {
                chatId: chatId,
                nombre,
                tienda,
                accion,
                jobType: 'asistencia',
                botToken: storedBotToken,
                originalMessageText: `/marcar ${nombre} ${tienda} ${accion}`
            };

            commandQueue.push(job);
            delete chatStates[chatId];

            await removeTelegramKeyboard(chatId, `✅ ¡Listo! Registrando asistencia: ${accion} para ${nombre} en ${tienda}. ✨`, storedBotToken);
            processCommandQueue();
        }
    }
};
