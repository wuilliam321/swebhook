const { 
    createOutfitConversationState, 
    handleOutfitProgress, 
    buildOutfitSummary 
} = require('../outfit');
const { sendTelegramMessage } = require('../api/telegram');
const { commandQueue, processCommandQueue, isJobDuplicate } = require('../queue');

/**
 * Command to create outfits.
 * Handles the initial /outfit command and the subsequent multi-step conversation.
 */
module.exports = {
    /**
     * Identifies if this command should handle the user input.
     */
    canHandle: (userCommand, chatState) => {
        return userCommand === "/outfit" || (chatState && chatState.state === "OUTFIT_COLLECTING") || false;
    },

    /**
     * Executes the command logic.
     */
    execute: async (context) => {
        const { chatId, userCommand, botToken, botName, chatStates, req } = context;

        // --- Step 1: Initial Command ---
        if (userCommand === "/outfit") {
            const conversationState = createOutfitConversationState(botName, botToken);
            chatStates[chatId] = conversationState;
            await sendTelegramMessage(
                chatId,
                "🧵 Vamos a crear un atuendo. Ingresa el código de la prenda completa (fullBody) o escribe \"skip\" para combinar piezas separadas.",
                botToken
            );
            return;
        }

        // --- Step 2: Handle Conversation Progress ---
        if (chatStates[chatId] && chatStates[chatId].state === "OUTFIT_COLLECTING") {
            const storedBotToken = chatStates[chatId].botToken || botToken;
            await handleOutfitProgress({
                chatId,
                text: req.body.message.text,
                chatStatesRef: chatStates,
                sendMessage: (message) => sendTelegramMessage(chatId, message, storedBotToken),
                enqueueJob: async (jobPayload) => {
                    const payloadSummary = jobPayload.summary || buildOutfitSummary(jobPayload.pieces || {});
                    const job = {
                        chatId: chatId,
                        originalMessageText: '/outfit',
                        jobType: 'outfit',
                        botToken: storedBotToken,
                        pieces: jobPayload.pieces || {},
                        summary: payloadSummary,
                        useFullBody: jobPayload.useFullBody
                    };
                    
                    if (jobPayload.userPreferences && Object.keys(jobPayload.userPreferences).length > 0) {
                        job.userPreferences = jobPayload.userPreferences;
                    }

                    if (isJobDuplicate(job)) {
                        await sendTelegramMessage(chatId, `⏳ Ya se está generando un atuendo idéntico. Por favor espera.`, storedBotToken);
                        return;
                    }

                    commandQueue.push(job);
                    processCommandQueue();
                }
            });
        }
    }
};
