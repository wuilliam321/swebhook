const express = require("express");
const {
    WEBHOOK_VERIFY_TOKEN,
    getTokenForBot,
    isValidBotName
} = require('./config');
const {
    extractBotName,
    extractBaseCommand,
    runCommand
} = require('./utils');
const {
    updateTelegramPrompt,
    sendFBMessage
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
    require('./commands/outfit'),
    require('./commands/marcar'),
    require('./commands/solicitarReembolso')
];

const app = express();
app.use(express.json());

const { BOT_TOKENS } = require('./config');
const { conversationContext, sessionFor, stateView, newOperation, logEvent, rememberUpdate, serial } = require('./conversations');
const axios = require('axios').default;

async function telegramUpdate(req) {
    const callback = req.body.callback_query;
    const message = callback?.message || req.body.message;
    const user = callback?.from || message?.from;
    if (!message || !user || user.is_bot) return;
    const configured = [...new Set(Object.values(BOT_TOKENS).filter(Boolean))];
    const bot = req.params?.bot || 'default';
    const token = BOT_TOKENS[bot];
    if (!token || (!req.params?.bot && configured.length !== 1)) {
        throw new Error('Webhook requiere bot receptor explícito');
    }
    const session = sessionFor(token.split(':')[0], message.chat.id, user.id);
    return serial(session, async () => {
        const started = Date.now();
        let userCommand = message.text || '';
        const stateBefore = session.state?.state;
        const context = { session, bot: token.split(':')[0], chatId: message.chat.id,
            userId: user.id, messageId: message.message_id, operationId: session.operationId };
        return conversationContext.run(context, async () => {
            const notify = async text => {
                if (callback) {
                    try {
                        await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                            callback_query_id: callback.id, text
                        }, { timeout: 15000 });
                    } catch (error) {
                        logEvent('callback_answer_failed', { code: error.code, status: error.response?.status });
                    }
                } else {
                    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                        chat_id: message.chat.id, text,
                        reply_markup: { remove_keyboard: true },
                        reply_parameters: { message_id: message.message_id }
                    }, { timeout: 15000 });
                }
            };
            if (callback) {
                const [, promptId, indexText] = (callback.data || '').split(':');
                const prompt = session.prompt;
                const index = Number(indexText);
                if (!callback.data?.startsWith('flow:') || !prompt || prompt.id !== promptId ||
                    prompt.messageId !== message.message_id || !Number.isInteger(index) || !prompt.values?.[index]) {
                    logEvent('input_rejected', { reason: 'foreign_or_stale_button' });
                    await notify('Este botón ya no está disponible para ti. Escribe /marcar para empezar de nuevo.');
                    return;
                }
                userCommand = prompt.values[index];
                await notify('');
                await updateTelegramPrompt(message.chat.id, prompt, token);
                session.prompt = undefined;
            }
            const isCommand = userCommand.startsWith('/');
            const mentionedBot = extractBotName(userCommand);
            if (isCommand && mentionedBot && (!isValidBotName(mentionedBot) || getTokenForBot(mentionedBot) !== token)) {
                logEvent('input_rejected', { reason: 'wrong_bot' });
                return;
            }
            const baseCommand = extractBaseCommand(userCommand);
            const handler = isCommand ? commands.find(command => command.canHandle(baseCommand, undefined)) :
                commands.find(command => command.canHandle(baseCommand, session.state));
            if (!handler) {
                logEvent('input_rejected', { reason: 'no_matching_flow' });
                if (!callback && !isCommand) await notify('Sin operación activa. Inicia el comando que necesitas.');
                return;
            }
            if (isCommand) {
                await updateTelegramPrompt(message.chat.id, session.prompt, token);
                await notify('Iniciando operación. Usa las opciones del nuevo mensaje.');
                newOperation(session);
                context.operationId = session.operationId;
            } else if (!callback) {
                const prompt = session.prompt;
                if (!prompt?.messageId || message.reply_to_message?.message_id !== prompt.messageId) {
                    logEvent('input_rejected', { reason: 'reply_to_current_prompt_required' });
                    await notify('Responde directamente a la pregunta vigente de tu operación.');
                    return;
                }
                if (prompt.values && !prompt.values.includes(baseCommand)) {
                    await notify('Selecciona una opción de la pregunta vigente.');
                    return;
                }
                await updateTelegramPrompt(message.chat.id, prompt, token);
                session.prompt = undefined;
            }
            const scopedStates = stateView(session, context.operationId);
            const request = callback ? { ...req, body: { ...req.body, message: { ...message, from: user, text: baseCommand } } } : req;
            logEvent('update_started', { updateId: req.body.update_id, command: isCommand ? baseCommand.split(/\s/)[0] : undefined });
            await handler.execute({ chatId: message.chat.id, userCommandRaw: userCommand,
                userCommand: baseCommand, botToken: token, botName: bot, isGroupChat: message.chat.type !== 'private',
                chatStates: scopedStates, req: request });
            logEvent('update_completed', { updateId: req.body.update_id, from: stateBefore,
                to: session.state?.state, durationMs: Date.now() - started });
        });
    });
}

async function telegramWebhook(req, res) {
    try {
        if (!req.params?.bot && new Set(Object.values(BOT_TOKENS).filter(Boolean)).size !== 1) {
            throw new Error('Webhook ambiguo');
        }
        const bot = (BOT_TOKENS[req.params?.bot || 'default'] || '').split(':')[0];
        const work = () => telegramUpdate(req);
        if (req.body.update_id !== undefined) await rememberUpdate(`${bot}:${req.body.update_id}`, work);
        else await work();
        res.status(200).send('OK');
    } catch (error) {
        console.error(JSON.stringify({ event: 'telegram_update_failed', updateId: req.body.update_id,
            code: error.code, message: 'No se pudo procesar actualización' }));
        res.status(500).send('Processing failed');
    }
}

app.post('/telegram', telegramWebhook);
app.post('/telegram/:bot', telegramWebhook);

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
