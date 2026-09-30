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
    if (!draft.employee) {
        state.state = 'WAITING_REIMBURSEMENT_EMPLOYEE';
        const rows = state.employees.reduce((result, employee, index) => {
            if (index % 2 === 0) result.push([]);
            result[result.length - 1].push(employee);
            return result;
        }, []);
        await sendTelegramKeyboard(chatId, 'Selecciona la empleada(o) que registra el gasto.', rows, botToken);
        return;
    }
    if (state.extractionPending || !state.employeeReady) return;
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
        await sendTelegramMessage(chatId, 'Recibimos tu solicitud. Te haremos el reembolso a la brevedad posible.', botToken);
    } catch (error) {
        delete chatStates[chatId];
        console.error('Error guardando reembolso:', error.response?.data || error.message);
        await sendTelegramMessage(chatId, 'No pude confirmar el registro. Revisa la planilla antes de enviar otra solicitud.', botToken);
    }
}

async function processPhoto(chatId, fileId, caption, botToken, chatStates) {
    let state;
    try {
        const image = await downloadPhoto(fileId, botToken);
        const { reasons, accounts, employees } = await getOptions();
        if (!reasons.length) throw new Error('No hay motivos en Cuentas!E:E');
        if (!employees.length) throw new Error('No hay empleadas en Cuentas!M:M');
        const account = canonical('BS Pago Movil', accounts);
        if (!account) throw new Error('BS Pago Movil no existe en Cuentas!K:K');
        const imageUrl = await uploadReceipt(image);
        state = { state: processing, draft: { account }, reasons, employees, imageUrl, botToken, extractionPending: true, employeeReady: false };
        chatStates[chatId] = state;
        await advance(chatId, state, chatStates);
        const draft = await extractReceipt(image, caption, reasons);
        if (chatStates[chatId] !== state) return;
        Object.assign(state.draft, draft);
        state.extractionPending = false;
        if (state.employeeReady) await advance(chatId, state, chatStates);
    } catch (error) {
        if (state && chatStates[chatId] !== state) return;
        chatStates[chatId] = { state: waitingPhoto, botToken };
        console.error('Error procesando reembolso:', error.response?.data || error.message);
        const message = `No pude procesar el comprobante: ${error.message}. Envía otra foto.`;
        if (state?.state === 'WAITING_REIMBURSEMENT_EMPLOYEE') {
            await removeTelegramKeyboard(chatId, message, botToken);
        } else {
            await sendTelegramMessage(chatId, message, botToken);
        }
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
        } else if (current.state === 'WAITING_REIMBURSEMENT_EMPLOYEE') {
            current.draft.employee = canonical(userCommand, current.employees);
            if (!current.draft.employee) {
                await sendTelegramMessage(chatId, 'Selecciona una empleada(o) de la lista.', token);
                return;
            }
            current.state = processing;
            await removeTelegramKeyboard(chatId, 'Registrando solicitud.', token);
            if (chatStates[chatId] !== current) return;
            current.employeeReady = true;
        }
        await advance(chatId, current, chatStates);
    }
};
