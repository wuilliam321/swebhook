const { hasPendingCasheaAbonosJob, commandQueue, processCommandQueue } = require('../queue');
const { sendTelegramMessage } = require('../api/telegram');

/**
 * Command to query Cashea Abonos.
 * Usage: /cashea_abonos
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand) => {
        return userCommand === "/cashea_abonos";
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommandRaw, botToken, chatStates } = context;
        const account = 'gilza'; // Hardcoded as per original logic

        if (hasPendingCasheaAbonosJob(account)) {
            await sendTelegramMessage(
                chatId,
                `⏳ Ya hay una consulta de Cashea Abonos en proceso. Por favor espera a que termine.`,
                botToken
            );
            return;
        }

        const job = {
            chatId: chatId,
            account: account,
            originalMessageText: userCommandRaw,
            jobType: 'cashea_abonos',
            botToken: botToken
        };
        commandQueue.push(job);

        // Clean up state
        if (chatStates[chatId]) {
            delete chatStates[chatId];
        }

        await sendTelegramMessage(chatId, `⏳ Consultando Cashea Abonos BNC. Te avisaré cuando esté listo. 🔍`, botToken);

        processCommandQueue(); // Kick off processing if not already running
    }
};
