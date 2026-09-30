const { commandQueue, processCommandQueue } = require('../queue');
const { sendTelegramKeyboard, removeTelegramKeyboard } = require('../api/telegram');
const { getReminders } = require('../api/firebase');
const { getEmployees } = require('../api/reimbursement');

const STORES = [
    ["Rodeo", "History"],
    ["Evento Externo"]
];

const ACTIONS = [
    ["☀️ Apertura", "🍽️ Ir a comer"],
    ["🔙 Volver de comer", "🌙 Cierre"]
];
const REMINDER_ANSWERS = [["✅ Confirmo", "❌ No"]];

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

async function finishAsistencia(chatId, chatState, storedBotToken, chatStates) {
    const { nombre, tienda, accion, reminderAnswers = [] } = chatState;
    const remindersStr = reminderAnswers.join(' | ');

    const job = {
        chatId: chatId,
        nombre,
        tienda,
        accion,
        reminders: remindersStr,
        jobType: 'asistencia',
        botToken: storedBotToken,
        originalMessageText: `/marcar ${nombre} ${tienda} ${accion}`
    };

    commandQueue.push(job);
    delete chatStates[chatId];

    await removeTelegramKeyboard(chatId, `✅ ¡Listo! Registrando asistencia: ${accion} para ${nombre} en ${tienda}. ✨`, storedBotToken);
    processCommandQueue();
}

/**
 * Command to handle employee attendance marking.
 * Flow: /marcar -> Select Name -> Select Store -> Select Action -> (If Cierre) Confirm Reminders
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
                   "WAITING_FOR_ASISTENCIA_ACTION",
                   "WAITING_FOR_REMINDER_CONFIRMATION"
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
            const employees = await getEmployees();
            
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
            chatState.accion = userCommand;
            console.log(`Action selected: "${userCommand}". Checking if it contains "Cierre"...`);

            if (userCommand.toLowerCase().includes("cierre")) {
                console.log('Cierre detected. Fetching reminders from Firebase...');
                const reminders = await getReminders();
                console.log(`Reminders fetched: ${JSON.stringify(reminders)}`);
                
                if (reminders && reminders.length > 0) {
                    chatState.pendingReminders = [...reminders];
                    chatState.reminderAnswers = [];
                    chatState.state = "WAITING_FOR_REMINDER_CONFIRMATION";
                    
                    const firstReminder = chatState.pendingReminders[0];
                    console.log(`Starting reminder flow with: "${firstReminder}"`);
                    await sendTelegramKeyboard(chatId, `🔔 ${firstReminder}`, REMINDER_ANSWERS, storedBotToken);
                    return;
                } else {
                    console.log('No reminders found in Firebase or list is empty.');
                }
            }

            return await finishAsistencia(chatId, chatState, storedBotToken, chatStates);
        }

        // --- Step 5: Reminder Confirmation ---
        if (chatState.state === "WAITING_FOR_REMINDER_CONFIRMATION") {
            if (userCommand === "✅ Confirmo" || userCommand === "❌ No") {
                const reminder = chatState.pendingReminders.shift();
                chatState.reminderAnswers.push(`${reminder}, ${userCommand === "✅ Confirmo" ? 'Si, confirmo' : 'No, no confirmo'}`);
                
                if (chatState.pendingReminders.length > 0) {
                    // Show next reminder
                    const nextReminder = chatState.pendingReminders[0];
                    await sendTelegramKeyboard(chatId, `🔔 ${nextReminder}`, REMINDER_ANSWERS, storedBotToken);
                    return;
                } else {
                    // All reminders confirmed, finish
                    return await finishAsistencia(chatId, chatState, storedBotToken, chatStates);
                }
            } else {
                // If they typed something else, resend the current reminder
                const currentReminder = chatState.pendingReminders[0];
                await sendTelegramKeyboard(chatId, `⚠️ Selecciona una respuesta para continuar.\n\n🔔 ${currentReminder}`, REMINDER_ANSWERS, storedBotToken);
                return;
            }
        }
    }
};
