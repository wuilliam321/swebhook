const { commandQueue, processCommandQueue, isJobDuplicate } = require('../queue');
const { sendTelegramMessage } = require('../api/telegram');

/**
 * Command to generate financial reports.
 * Usage: /report (Step 1) followed by an option 0-6 (Step 2).
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand, chatState) => {
        return userCommand === "/report" || (chatState && chatState.state === "WAITING_FOR_REPORT_OPTION") || false;
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommand, botToken, chatStates } = context;

        // --- Step 1: Initial Command ---
        if (userCommand === "/report") {
            chatStates[chatId] = {
                state: "WAITING_FOR_REPORT_OPTION",
                botName: context.botName,
                botToken: botToken
            };
            await sendTelegramMessage(
                chatId,
                "📊 ¿Qué período deseas para el reporte?\n" +
                "[0] 📅 Hoy\n" +
                "[1] 🗓️ Semana actual\n" +
                "[2] 📆 Semana pasada\n" +
                "[3] 🗓️ Mes actual\n" +
                "[4] 📆 Mes pasado\n" +
                "[5] 📊 Trimestre actual\n" +
                "[6] 📈 Trimestre pasado",
                botToken
            );
            return;
        }

        // --- Step 2: Option Selection ---
        const chatState = chatStates[chatId];
        const storedBotToken = chatState.botToken || botToken;
        
        // Only accept numbers 0-6
        const validOptions = ["0", "1", "2", "3", "4", "5", "6"];
        const option = userCommand.trim();

        if (validOptions.includes(option)) {
            // Enqueue a report generation job
            const job = {
                chatId: chatId,
                period: option,
                originalMessageText: `/report ${option}`,
                jobType: 'report',
                botToken: storedBotToken
            };

            if (isJobDuplicate(job)) {
                await sendTelegramMessage(chatId, `⏳ Ya hay una solicitud de reporte para este período en proceso. Por favor espera.`, storedBotToken);
                return;
            }

            // Feedback to user
            await sendTelegramMessage(chatId, "⏳ Estamos generando tu reporte. Te lo enviaremos en cuanto esté listo. 🔒", storedBotToken);

            commandQueue.push(job);
            delete chatStates[chatId];
            processCommandQueue();
        } else {
            await sendTelegramMessage(chatId, "❗ Por favor, responde con un número entre 0 y 6 para seleccionar el período del reporte.", storedBotToken);
        }
    }
};
