const { hasPendingCierreJob, commandQueue, processCommandQueue } = require('../queue');
const { sendTelegramMessage } = require('../api/telegram');

/**
 * Command to calculate closure (cierre) of transactions.
 * Usage: /cierre_wuilliam or /cierre_gilza
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand) => {
        return userCommand && userCommand.startsWith("/cierre_");
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommandRaw, userCommand, botToken, isGroupChat, chatStates } = context;
        
        const account = userCommand.substring("/cierre_".length);
        if (['wuilliam', 'gilza'].includes(account)) {

            // Check if there's already a cierre job for THIS account processing or queued
            if (hasPendingCierreJob(account)) {
                await sendTelegramMessage(
                    chatId,
                    `⏳ Ya hay una solicitud de cierre para "${account}" en proceso. Por favor espera a que termine.`,
                    botToken
                );
                return;
            }

            const job = {
                chatId: chatId,
                account: account,
                originalMessageText: userCommandRaw,
                jobType: 'cierre',
                botToken: botToken,
                isGroupChat: isGroupChat
            };
            commandQueue.push(job);

            // Clean up state
            if (chatStates[chatId]) {
                delete chatStates[chatId];
            }

            const capitalizedAccount = account.charAt(0).toUpperCase() + account.slice(1);
            await sendTelegramMessage(
                chatId, 
                `⏳ Calculando cierre de PagoMóvil ${capitalizedAccount} en BBVA Provincial. Te avisaré cuando esté listo. 🏦`, 
                botToken
            );

            processCommandQueue(); // Kick off processing if not already running
        }
    }
};
