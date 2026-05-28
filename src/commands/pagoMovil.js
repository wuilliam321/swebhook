const { hasPendingPagoMovilJob, commandQueue, processCommandQueue } = require('../queue');
const { sendTelegramMessage } = require('../api/telegram');

/**
 * Command to query Pago Movil transactions.
 * Usage: /pagomovil_wuilliam or /pagomovil_gilza
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand) => {
        return userCommand && userCommand.startsWith("/pagomovil_");
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommandRaw, userCommand, botToken, isGroupChat, chatStates } = context;
        
        const account = userCommand.substring("/pagomovil_".length);
        if (['wuilliam', 'gilza'].includes(account)) {

            // Check if there's already a pagomovil job for THIS account processing or queued
            if (hasPendingPagoMovilJob(account)) {
                await sendTelegramMessage(
                    chatId,
                    `⏳ Ya hay una consulta de PagoMóvil para "${account}" en proceso. Por favor espera a que termine.`,
                    botToken
                );
                return;
            }

            const job = {
                chatId: chatId,
                account: account,
                originalMessageText: userCommandRaw,
                jobType: 'pagomovil',
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
                `⏳ Consultando transacciones de PagoMóvil ${capitalizedAccount} en BBVA Provincial. Te avisaré cuando esté listo. 🔍`, 
                botToken
            );

            processCommandQueue(); // Kick off processing if not already running
        }
    }
};
