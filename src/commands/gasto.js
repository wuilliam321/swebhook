const { commandQueue, processCommandQueue, isJobDuplicate } = require('../queue');
const { sendTelegramMessage } = require('../api/telegram');
const { extractExpense, validateExpense, questionFor } = require('../expense');
const { recordExpense } = require('../api/sheetsExpenses');

const STORE_COMMANDS = { '/gastos_history': 'History', '/gastos_rodeo': 'Rodeo' };

function transactionId(message, chatId) {
    return message.update_id ? `telegram:${message.update_id}` : `telegram:${chatId}:${message.message_id || 'unknown'}`;
}

async function handleStructuredExpense(context) {
    const { chatId, userCommand, botToken, chatStates, req } = context;
    const message = req.body.message;
    if (STORE_COMMANDS[userCommand]) {
        chatStates[chatId] = { state: 'WAITING_FOR_STRUCTURED_EXPENSE', store: STORE_COMMANDS[userCommand], botToken };
        await sendTelegramMessage(chatId, '💰 ¿Qué gasto deseas registrar?', botToken);
        return true;
    }
    const state = chatStates[chatId];
    if (!state || state.state !== 'WAITING_FOR_STRUCTURED_EXPENSE') return false;
    if (!userCommand) { await sendTelegramMessage(chatId, '❗ Envía el gasto como texto.', state.botToken || botToken); return true; }
    try {
        const draft = await extractExpense(userCommand, state.store, state.draft);
        const missing = validateExpense(draft);
        if (missing.length) {
            chatStates[chatId] = { ...state, draft, state: 'WAITING_FOR_STRUCTURED_EXPENSE' };
            await sendTelegramMessage(chatId, questionFor(missing[0]), state.botToken || botToken);
            return true;
        }
        await recordExpense(draft, transactionId(req.body, chatId));
        delete chatStates[chatId];
        await sendTelegramMessage(chatId, '✅ Gasto registrado con éxito.', state.botToken || botToken);
    } catch (error) {
        console.error('Error registrando gasto estructurado:', error.response ? error.response.data : error.message);
        await sendTelegramMessage(chatId, `❌ Error registrando gasto: ${error.message}`, state.botToken || botToken);
    }
    return true;
}

/**
 * Command to record expenses (gastos).
 * Handles initial command and subsequent amount/description input (including media).
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand, chatState) => {
        return userCommand === "/gasto" || Boolean(STORE_COMMANDS[userCommand]) || (chatState && (chatState.state === "WAITING_FOR_AMOUNT" || chatState.state === 'WAITING_FOR_STRUCTURED_EXPENSE')) || false;
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommand, botToken, chatStates, req } = context;

        if (await handleStructuredExpense(context)) return;

        // --- Step 1: Initial Command ---
        if (userCommand === "/gasto") {
            chatStates[chatId] = {
                state: "WAITING_FOR_AMOUNT",
                botName: context.botName, // Need to ensure botName is in context if needed, but app.js has it
                botToken: botToken
            };
            await sendTelegramMessage(chatId, "💰 ¿Cuánto gastaste y en qué?", botToken);
            return;
        }

        // --- Step 2: Amount/Description Input (State: WAITING_FOR_AMOUNT) ---
        const chatState = chatStates[chatId];
        const storedBotToken = chatState.botToken || botToken;
        const message = req.body.message;
        const phone = message.from ? message.from.phone_number || message.from.id || "unknown" : "unknown";
        
        let spendingText = userCommand;
        
        // Use caption if text is empty (common in media messages)
        if (!spendingText && message.caption) {
            spendingText = message.caption;
        }

        let fileId = null;
        let mediaType = null;

        if (message.voice) {
            fileId = message.voice.file_id;
            mediaType = 'voice';
        } else if (message.audio) {
            fileId = message.audio.file_id;
            mediaType = 'audio';
        } else if (message.photo) {
             // Take the largest photo
            const largestPhoto = message.photo[message.photo.length - 1];
            fileId = largestPhoto.file_id;
            mediaType = 'photo';
        }

        // Handle Photo without Caption: Ask for text
        if (mediaType === 'photo' && !spendingText) {
             chatState.pendingFileId = fileId;
             chatState.pendingMediaType = mediaType;
             
             await sendTelegramMessage(chatId, "📸 Foto recibida. ¿Cuánto gastaste y en qué? (Envía texto para completar)", storedBotToken);
             return;
        }

        // Handle Text following a pending Photo
        if (!fileId && spendingText && chatState.pendingFileId) {
             fileId = chatState.pendingFileId;
             mediaType = chatState.pendingMediaType;
             // We will consume the pending file now
        }

        if (!spendingText && !fileId) {
             await sendTelegramMessage(chatId, "❗ Por favor, envía texto, una nota de voz o una foto.", storedBotToken);
             return;
        }

        const modifiedCommand = `${spendingText || ''} source:${phone}`;

        const job = {
            chatId: chatId,
            spending: modifiedCommand,
            originalMessageText: spendingText || '[Media]',
            jobType: 'gasto',
            botToken: storedBotToken,
            fileId: fileId,
            mediaType: mediaType
        };

        if (isJobDuplicate(job)) {
            await sendTelegramMessage(chatId, `⏳ Ya se está procesando este gasto "${spendingText || '[Media]'}".`, storedBotToken);
            return;
        }

        commandQueue.push(job);
        delete chatStates[chatId]; 

        const confirmationMsg = fileId 
            ? `⏳ Gasto multimedia recibido. Procesando... ✨`
            : `⏳ Gasto "${spendingText}" encolado. Te avisaré cuando esté listo. ✨`;

        await sendTelegramMessage(chatId, confirmationMsg, storedBotToken);
        processCommandQueue();
    }
};
