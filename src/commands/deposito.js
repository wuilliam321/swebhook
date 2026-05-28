const { commandQueue, processCommandQueue, isJobDuplicate } = require('../queue');
const { sendTelegramMessage } = require('../api/telegram');

/**
 * Command to query deposit information by product code.
 * Usage: /deposito (Step 1) followed by the product code (Step 2).
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand, chatState) => {
        return userCommand === "/deposito" || (chatState && chatState.state === "WAITING_FOR_DEPOSITO_PRODUCT_CODE") || false;
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommand, botToken, botName, chatStates, isGroupChat } = context;

        // --- Step 1: Initial Command ---
        if (userCommand === "/deposito") {
            chatStates[chatId] = {
                state: "WAITING_FOR_DEPOSITO_PRODUCT_CODE",
                botName: botName,
                botToken: botToken
            };
            await sendTelegramMessage(chatId, "🔍 Por favor, ingresa el código del producto para consultar en depósito:", botToken);
            return;
        }

        // --- Step 2: Deposit Product Code Input ---
        const chatState = chatStates[chatId];
        const storedBotToken = chatState.botToken || botToken;
        const productCode = userCommand.trim();

        if (productCode) {
            const job = {
                chatId: chatId,
                code: productCode,
                originalMessageText: productCode,
                jobType: 'deposito_lookup',
                botToken: storedBotToken,
                isGroupChat: isGroupChat
            };

            if (isJobDuplicate(job)) {
                await sendTelegramMessage(chatId, `⏳ Ya hay una consulta de depósito para el producto "${productCode}" en proceso.`, storedBotToken);
                return;
            }

            await sendTelegramMessage(chatId, `⏳ Consultando información de depósito para el código "${productCode}". Te informaremos cuando esté listo.`, storedBotToken);

            commandQueue.push(job);
            delete chatStates[chatId];
            processCommandQueue();
        } else {
            await sendTelegramMessage(chatId, "❗ Por favor, ingresa un código de producto válido.", storedBotToken);
        }
    }
};
