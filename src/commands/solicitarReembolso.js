const { sendTelegramMessage, sendTelegramKeyboard, removeTelegramKeyboard } = require('../api/telegram');
const { downloadPhoto, getOptions, extractReceipt, uploadReceipt, appendReimbursement, normalizeDate, normalizeAmount, canonical } = require('../api/reimbursement');

const commandName = '/solicitar_reembolso';
const waitingPhoto = 'WAITING_REIMBURSEMENT_PHOTO';
const processing = 'PROCESSING_REIMBURSEMENT';

function amountAndCurrency(text) {
    const match = String(text || '').trim().match(/^(USD|VES|BS|\$)\s*([\d.,]+)$|^([\d.,]+)\s*(USD|VES|BS|\$)$/i);
    if (!match) return null;
    const currency = (match[1] || match[4]).toUpperCase();
    const amount = normalizeAmount(match[2] || match[3]);
    return amount ? { amount, currency: currency === 'BS' ? 'VES' : currency === '$' ? 'USD' : currency } : null;
}

async function advance(chatId, state, chatStates) {
    const { draft, botToken } = state;
    if (!draft.date) {
        state.state = 'WAITING_REIMBURSEMENT_DATE';
        await sendTelegramMessage(chatId, '¿Qué fecha tiene el pago? Responde DD/MM/YYYY.', botToken);
        return;
    }
    if (!draft.amount || !draft.currency) {
        state.state = 'WAITING_REIMBURSEMENT_AMOUNT';
        await sendTelegramMessage(chatId, 'Indica monto y moneda: USD 25.50 o VES 1000.00.', botToken);
        return;
    }
    if (!draft.reason) {
        state.state = 'WAITING_REIMBURSEMENT_REASON';
        const rows = state.reasons.reduce((result, reason, index) => {
            if (index % 2 === 0) result.push([]);
            result[result.length - 1].push(reason);
            return result;
        }, []);
        await sendTelegramKeyboard(chatId, 'Selecciona el motivo del reembolso.', rows, botToken);
        return;
    }
    state.state = processing;
    try {
        await appendReimbursement(draft, state.imageUrl);
        delete chatStates[chatId];
        await removeTelegramKeyboard(chatId, 'Recibimos tu solicitud. Te haremos el reembolso a la brevedad posible.', botToken);
    } catch (error) {
        delete chatStates[chatId];
        console.error('Error guardando reembolso:', error.response?.data || error.message);
        await sendTelegramMessage(chatId, 'No pude confirmar el registro. Revisa la planilla antes de enviar otra solicitud.', botToken);
    }
}

async function processPhoto(chatId, fileId, caption, botToken, chatStates) {
    try {
        const image = await downloadPhoto(fileId, botToken);
        const { reasons, accounts } = await getOptions();
        if (!reasons.length) throw new Error('No hay motivos en Cuentas!E:E');
        const account = canonical('BS Pago Movil', accounts);
        if (!account) throw new Error('BS Pago Movil no existe en Cuentas!K:K');
        const draft = await extractReceipt(image, caption, reasons);
        draft.account = account;
        const imageUrl = await uploadReceipt(image);
        const state = { state: processing, draft, reasons, imageUrl, botToken };
        chatStates[chatId] = state;
        await advance(chatId, state, chatStates);
    } catch (error) {
        chatStates[chatId] = { state: waitingPhoto, botToken };
        console.error('Error procesando reembolso:', error.response?.data || error.message);
        await sendTelegramMessage(chatId, `No pude procesar el comprobante: ${error.message}. Envía otra foto.`, botToken);
    }
}

module.exports = {
    canHandle: (userCommand, chatState) => userCommand === commandName || Boolean(chatState?.state?.includes('REIMBURSEMENT')),
    execute: async ({ chatId, userCommand, botToken, chatStates, req }) => {
        const current = chatStates[chatId];
        if (userCommand === commandName) {
            if (current?.state === processing) {
                await sendTelegramMessage(chatId, 'Tu comprobante sigue en proceso.', current.botToken || botToken);
                return;
            }
            chatStates[chatId] = { state: waitingPhoto, botToken };
            await sendTelegramMessage(chatId, 'Adjunta una foto del comprobante del pago que deseas reembolsar.', botToken);
            return;
        }
        if (!current) return;
        const token = current.botToken || botToken;
        if (current.state === waitingPhoto) {
            const photo = req.body.message.photo?.at(-1);
            if (!photo?.file_id) {
                await sendTelegramMessage(chatId, 'Adjunta una foto del comprobante.', token);
                return;
            }
            current.state = processing;
            await sendTelegramMessage(chatId, 'Comprobante recibido. Estoy registrando la solicitud.', token);
            processPhoto(chatId, photo.file_id, req.body.message.caption, token, chatStates);
            return;
        }
        if (current.state === processing) {
            await sendTelegramMessage(chatId, 'Tu comprobante sigue en proceso.', token);
            return;
        }
        if (current.state === 'WAITING_REIMBURSEMENT_DATE') {
            current.draft.date = normalizeDate(userCommand);
            if (!current.draft.date) {
                await sendTelegramMessage(chatId, 'Fecha inválida. Responde DD/MM/YYYY.', token);
                return;
            }
        } else if (current.state === 'WAITING_REIMBURSEMENT_AMOUNT') {
            const value = amountAndCurrency(userCommand);
            if (!value) {
                await sendTelegramMessage(chatId, 'Monto inválido. Responde USD 25.50 o VES 1000.00.', token);
                return;
            }
            Object.assign(current.draft, value);
        } else if (current.state === 'WAITING_REIMBURSEMENT_REASON') {
            current.draft.reason = canonical(userCommand, current.reasons);
            if (!current.draft.reason) {
                await sendTelegramMessage(chatId, 'Selecciona un motivo de la lista.', token);
                return;
            }
        }
        await advance(chatId, current, chatStates);
    }
};
