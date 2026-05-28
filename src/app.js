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
    hasPendingCierreJob,
    hasPendingCasheaAbonosJob,
    isJobDuplicate
} = require('./queue');
const {
    sendTelegramMessage,
    sendFBMessage,
    sendProductDetails
} = require('./api/telegram');
const { generateRequest } = require('./api/inventory');

const commands = [
    require('./commands/pagoMovil'),
    require('./commands/cierre'),
    require('./commands/casheaAbonos'),
    require('./commands/gasto'),
    require('./commands/report'),
    require('./commands/consultaCodigo'),
    require('./commands/deposito'),
    require('./commands/outfit')
];

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
    // We allow non-text messages if we are in a state that expects them (e.g. WAITING_FOR_AMOUNT)
    if (!req.body.message.text && !chatStates[chatId]) {
        console.log("Received non-text message",
            req.body.message.new_chat_member ? "new_chat_member" :
                req.body.message.new_chat_members ? "new_chat_members" :
                    "unknown message type",
            isGroupChat ? "(group chat)" : "(private chat)");

        // We could add welcome messages or other handling here if needed

        res.status(200).send('OK'); // Acknowledge receipt
        return;
    }

    const userCommandRaw = req.body.message.text || '';

    // Extract bot name and base command if present
    const botName = extractBotName(userCommandRaw);
    const userCommand = extractBaseCommand(userCommandRaw);

    // Get token for this bot
    const botToken = botName ? getTokenForBot(botName) : TELEGRAM_TOKEN;

    // Log details about the incoming command
    console.log(
        "CHAT req:",
        userCommandRaw ? userCommandRaw : '[Media Message]',
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

    // Orchestrator: Try to handle the command with specialized command objects
    const context = { chatId, userCommandRaw, userCommand, botToken, botName, isGroupChat, chatStates, req, res };
    for (const command of commands) {
        if (command.canHandle(userCommand, chatStates[chatId])) {
            await command.execute(context);
            return res.status(200).send('OK');
        }
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
