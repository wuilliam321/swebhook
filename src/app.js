const express = require("express");
const {
    WEBHOOK_VERIFY_TOKEN,
    TELEGRAM_TOKEN,
    PORT,
    getTokenForBot,
    isValidBotName
} = require('./config');
const {
    extractBotName,
    extractBaseCommand,
    runCommand
} = require('./utils');
const { chatStates } = require('./state');
const {
    commandQueue,
    processCommandQueue,
    hasPendingPagoMovilJob,
    isProcessingPagoMovil
} = require('./queue');
const {
    sendTelegramMessage,
    sendFBMessage,
    sendProductDetails
} = require('./api/telegram');
const { generateRequest } = require('./api/inventory');
const {
    createOutfitConversationState,
    handleOutfitProgress,
    buildOutfitSummary
} = require('./outfit');

const app = express();
app.use(express.json());

app.post("/telegram", async (req, res) => {
    console.log("CHAT full request", req.body);

    // Handle different types of Telegram updates
    // my_chat_member updates occur when bot is added/removed from groups
    if (req.body.my_chat_member) {
        console.log("Received my_chat_member update", req.body.my_chat_member);
        res.status(200).send('OK'); // Acknowledge receipt
        return;
    }

    // Handle other update types like callback_query, edited_message, etc.
    if (!req.body.message) {
        console.log("Received non-message update", Object.keys(req.body));
        res.status(200).send('OK'); // Acknowledge receipt
        return;
    }
    const chatId = req.body.message.chat.id;

    // Determine if this is a group chat
    const isGroupChat = req.body.message.chat.type === 'group'
        || req.body.message.chat.type === 'supergroup';

    // Handle non-text messages (new chat members, photos, etc.)
    if (!req.body.message.text) {
        console.log("Received non-text message",
            req.body.message.new_chat_member ? "new_chat_member" :
                req.body.message.new_chat_members ? "new_chat_members" :
                    "unknown message type",
            isGroupChat ? "(group chat)" : "(private chat)");

        // We could add welcome messages or other handling here if needed

        res.status(200).send('OK'); // Acknowledge receipt
        return;
    }

    const userCommandRaw = req.body.message.text;

    // Extract bot name and base command if present
    const botName = extractBotName(userCommandRaw);
    const userCommand = extractBaseCommand(userCommandRaw);

    // Get token for this bot
    const botToken = botName ? getTokenForBot(botName) : TELEGRAM_TOKEN;

    // Log details about the incoming command
    console.log(
        "CHAT req:",
        userCommandRaw,
        botName ? `(bot: ${botName})` : '',
        isGroupChat ? '(group chat)' : '(private chat)',
        isValidBotName(botName) ? '(valid bot)' : botName ? '(unknown bot)' : ''
    );

    // Validate bot name in group chats - commands in group chats should include valid bot name
    if (isGroupChat && userCommandRaw.startsWith('/') && botName && !isValidBotName(botName)) {
        console.log(`Ignoring command with unknown bot name: ${botName}`);
        res.status(200).send('OK');
        return;
    }

    // --- /gasto command ---
    if (userCommand === "/gasto") {
        chatStates[chatId] = {
            state: "WAITING_FOR_AMOUNT",
            botName: botName,
            botToken: botToken
        };
        await sendTelegramMessage(chatId, "💰 ¿Cuánto gastaste y en qué?", botToken);
        res.status(200).send('OK');
        return;
    }

    // --- /pagomovil command ---
    if (userCommand.startsWith("/pagomovil_")) {
        const account = userCommand.substring("/pagomovil_".length);
        if (['wuilliam', 'gilza'].includes(account)) {

            // Check if there's already a pagomovil job processing or queued
            if (isProcessingPagoMovil || hasPendingPagoMovilJob()) {
                await sendTelegramMessage(
                    chatId,
                    `⏳ Ya hay una consulta de PagoMóvil en proceso. Por favor espera a que termine antes de solicitar otra.`,
                    botToken
                );
                res.status(200).send('OK');
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

            delete chatStates[chatId]; // Delete state *after* queuing the job. 

            const capitalizedAccount = account.charAt(0).toUpperCase() + account.slice(1);
            await sendTelegramMessage(chatId, `⏳ Consultando transacciones de PagoMóvil ${capitalizedAccount} en BBVA Provincial. Te avisaré cuando esté listo. 🔍`, botToken);

            processCommandQueue(); // Kick off processing if not already running
        }
        res.status(200).send('OK');
        return;
    }

    // --- /report command: Step 1 ---
    if (userCommand === "/report") {
        chatStates[chatId] = {
            state: "WAITING_FOR_REPORT_OPTION",
            botName: botName,
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
        res.status(200).send('OK');
        return;
    }

    // --- /consulta_codigo command: Step 1 ---
    if (userCommand === "/consulta_codigo") {
        chatStates[chatId] = {
            state: "WAITING_FOR_PRODUCT_CODE",
            botName: botName,
            botToken: botToken
        };
        await sendTelegramMessage(chatId, "🔍 Por favor, ingresa el código del producto que deseas consultar:", botToken);
        res.status(200).send('OK');
        return;
    }

    // --- /deposito command: Step 1 ---
    if (userCommand === "/deposito") {
        chatStates[chatId] = {
            state: "WAITING_FOR_DEPOSITO_PRODUCT_CODE",
            botName: botName,
            botToken: botToken
        };
        await sendTelegramMessage(chatId, "🔍 Por favor, ingresa el código del producto para consultar en depósito:", botToken);
        res.status(200).send('OK');
        return;
    }


    if (userCommand === "/outfit") {
        const conversationState = createOutfitConversationState(botName, botToken);
        chatStates[chatId] = conversationState;
        await sendTelegramMessage(
            chatId,
            "🧵 Vamos a crear un atuendo. Ingresa el código de la prenda completa (fullBody) o escribe \"skip\" para combinar piezas separadas.",
            botToken
        );
        res.status(200).send('OK');
        return;
    }

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
                commandQueue.push(job);
                processCommandQueue();
            }
        });
        res.status(200).send('OK');
        return;
    }

    // --- /report option selection ---
    if (chatStates[chatId] && chatStates[chatId].state === "WAITING_FOR_REPORT_OPTION") {
        // Get the stored bot token for this conversation
        const storedBotToken = chatStates[chatId].botToken || botToken;
        // Only accept numbers 0-6
        const validOptions = ["0", "1", "2", "3", "4", "5", "6"];
        if (validOptions.includes(userCommand.trim())) {
            // Feedback to user
            await sendTelegramMessage(chatId, "⏳ Estamos generando tu reporte. Te lo enviaremos en cuanto esté listo. 🔒", storedBotToken);

            // Enqueue a report generation job
            const job = {
                chatId: chatId,
                period: userCommand.trim(),
                originalMessageText: `/report ${userCommand.trim()}`,
                jobType: 'report',
                botToken: storedBotToken
            };
            commandQueue.push(job);
            delete chatStates[chatId];
            // Feedback to user is already sent above
            processCommandQueue();
        } else {
            await sendTelegramMessage(chatId, "❗ Por favor, responde con un número entre 0 y 6 para seleccionar el período del reporte.", storedBotToken);
        }
        res.status(200).send('OK');
        return;
    }

    // --- /consulta_codigo product code input ---
    if (chatStates[chatId] && chatStates[chatId].state === "WAITING_FOR_PRODUCT_CODE") {
        // Get the stored bot token for this conversation
        const storedBotToken = chatStates[chatId].botToken || botToken;
        if (userCommand.trim()) {
            // Feedback to user
            await sendTelegramMessage(chatId, `⏳ Consultando información del producto con código "${userCommand.trim()}". Te informaremos cuando esté listo.`, storedBotToken);

            // Enqueue a product lookup job
            const job = {
                chatId: chatId,
                code: userCommand.trim(),
                originalMessageText: userCommand.trim(),
                jobType: 'product_lookup',
                botToken: storedBotToken,
                isGroupChat: isGroupChat
            };
            commandQueue.push(job);
            delete chatStates[chatId];
            // Feedback to user is already sent above
            processCommandQueue();
        } else {
            await sendTelegramMessage(chatId, "❗ Por favor, ingresa un código de producto válido.", storedBotToken);
        }
        res.status(200).send('OK');
        return;
    }

    // --- /deposito product code input ---
    if (chatStates[chatId] && chatStates[chatId].state === "WAITING_FOR_DEPOSITO_PRODUCT_CODE") {
        const storedBotToken = chatStates[chatId].botToken || botToken;
        if (userCommand.trim()) {
            await sendTelegramMessage(chatId, `⏳ Consultando información de depósito para el código "${userCommand.trim()}". Te informaremos cuando esté listo.`, storedBotToken);

            const job = {
                chatId: chatId,
                code: userCommand.trim(),
                originalMessageText: userCommand.trim(),
                jobType: 'deposito_lookup',
                botToken: storedBotToken
            };
            commandQueue.push(job);
            delete chatStates[chatId];
            processCommandQueue();
        } else {
            await sendTelegramMessage(chatId, "❗ Por favor, ingresa un código de producto válido.", storedBotToken);
        }
        res.status(200).send('OK');
        return;
    }

    // --- /gasto amount input ---
    if (chatStates[chatId] && chatStates[chatId].state === "WAITING_FOR_AMOUNT") {
        // Get the stored bot token for this conversation
        const storedBotToken = chatStates[chatId].botToken || botToken;

        const phone = req.body.message.from ? req.body.message.from.phone_number || req.body.message.from.id || "unknown" : "unknown";
        const modifiedCommand = `${userCommand} source:${phone}`;

        const job = {
            chatId: chatId,
            spending: modifiedCommand,
            originalMessageText: userCommand, // Store the original message for notifications
            jobType: 'gasto',
            botToken: storedBotToken
        };
        commandQueue.push(job);

        delete chatStates[chatId]; // Delete state *after* queuing the job. 

        await sendTelegramMessage(chatId, `⏳ Gasto "${userCommand}" encolado. Te avisaré cuando esté listo. ✨`, storedBotToken);

        processCommandQueue(); // Kick off processing if not already running

        res.status(200).send('OK');
        return;
    }

    console.log("nothing to do for", userCommand);
    res.status(200).send('OK');
})

app.post("/chat", async (req, res) => {
    console.log("CHAT req", req["body"]);
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python';
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_zsoft.py';
    const args = ['--mode=stdin', `--spending=${req["body"]["message"]}`];
    runCommand(res, appPath, [scriptPath, ...args]); // Pass scriptPath as an arg
    res.send({
        "response": "en breve quedara registrado",
        "context_id": req["body"].context_id
    });
})

app.post("/webhook", async (req, res) => {
    const entry = req.body.entry[0];
    const changes = entry.changes[0];
    const value = changes.value;
    const message = value.messages && value.messages[0];

    console.log('req', JSON.stringify(req.body));

    if (message && message.text && message.text.body) {
        const res = await generateRequest({
            username: req.body.entry[0].id,
            message: message.text.body
        });
        await sendFBMessage(message.from, res.signedUrl)
        console.log("sent", message.text.body, "=>", res.signedUrl)
    }
    res.sendStatus(200);
});

// accepts GET requests at the /webhook endpoint. You need this URL to setup webhook initially.
// info on verification request payload: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // check the mode and token sent are correct
    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
        // respond with 200 OK and challenge token from the request
        res.status(200).send(challenge);
        console.log("Webhook verified successfully!");
    } else {
        // respond with '403 Forbidden' if verify tokens do not match
        res.sendStatus(403);
    }
});

app.get("/", (_, res) => {
    res.send(`<pre>Nothing to see here.
Checkout README.md to start.</pre>`);
});

module.exports = app;
