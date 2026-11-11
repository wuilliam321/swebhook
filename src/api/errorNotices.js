const axios = require('axios').default;
const { randomBytes } = require('crypto');
const { conversationContext, errorDetails, logEvent } = require('../conversations');

const pendingNotices = new Map();
const sentReferences = new Map();

function failureReason(error, service = 'el servicio necesario') {
  const details = errorDetails(error);
  const target = error.service === 'telegram' ? 'Telegram' : service;
  const message = String(error.message || '');
  if (details.status === 429) return `${target} limitó temporalmente las solicitudes`;
  if (['ECONNABORTED', 'ETIMEDOUT'].includes(details.code) || /timed?\s*out|timeout/i.test(message)) return `${target} no respondió a tiempo`;
  if (details.code && /CONN|NET|HOST|DNS|EAI/.test(details.code)) return `no se pudo conectar con ${target}`;
  if (details.status >= 500) return `${target} devolvió un error temporal`;
  if ([401, 403].includes(details.status)) return `${target} rechazó el acceso; hace falta revisar la configuración`;
  if (/not.found|no longer available/i.test(message)) return `${target} no tiene disponible el modelo o recurso configurado`;
  if (/parse|json|decodificar/i.test(message)) return `${target} no pudo interpretar los datos recibidos`;
  if (/no está configurad|not configured/i.test(message)) return `falta configuración necesaria para ${target}`;
  return `${target} no pudo completar la solicitud`;
}

async function deliver(notice) {
  if (notice.sending) return;
  notice.sending = true;
  notice.attempts++;
  try {
    await axios.post(`https://api.telegram.org/bot${notice.token}/sendMessage`, {
      chat_id: notice.chatId, text: notice.text
    }, { timeout: 15000 });
    pendingNotices.delete(notice.key);
    sentReferences.set(notice.key, Date.now());
    logEvent('error_notice_sent', { reference: notice.reference });
  } catch (error) {
    logEvent('error_notice_pending', { reference: notice.reference, attempt: notice.attempts, ...errorDetails(error) });
    if (notice.attempts < 3) {
      const wait = Math.max(5, Number(error.response?.data?.parameters?.retry_after) || 0) * 1000;
      notice.timer = setTimeout(() => {
        notice.timer = undefined;
        void deliver(notice);
      }, wait);
      notice.timer.unref?.();
    }
  } finally {
    notice.sending = false;
  }
}

async function sendErrorNotice(chatId, message, token, reference) {
  const context = conversationContext.getStore();
  reference ||= String(context?.updateId ?? context?.operationId ?? randomBytes(6).toString('hex'));
  const key = JSON.stringify([token.split(':')[0], chatId, reference]);
  for (const [id, time] of sentReferences) {
    if (Date.now() - time > 3600000 || sentReferences.size > 10000) sentReferences.delete(id);
  }
  if (pendingNotices.has(key) || sentReferences.has(key)) return;
  const notice = { key, chatId, token, reference, attempts: 0,
    text: `⚠️ ${message}\nReferencia: ${reference}` };
  pendingNotices.set(key, notice);
  await deliver(notice);
}

function flushErrorNotices(chatId, token) {
  for (const notice of pendingNotices.values()) {
    if (notice.chatId === chatId && notice.token === token && !notice.sending && !notice.timer) {
      notice.attempts = 0;
      void deliver(notice);
    }
  }
}

module.exports = { sendErrorNotice, flushErrorNotices, failureReason, pendingNotices, sentReferences };
