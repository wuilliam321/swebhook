const { sendTelegramMessage, sendTelegramKeyboard, removeTelegramKeyboard } = require('../api/telegram');
const { lookupCoupon, redeemCoupon } = require('../api/coupons');
const { CouponError, normalizeCode, normalizePhone, couponSummary } = require('../coupons');
const { logEvent, errorDetails } = require('../conversations');

const CANCEL = '❌ Cancelar';
const CONFIRM = '✅ Usar cupón';
const states = ['COUPON_CODE', 'COUPON_PHONE', 'COUPON_CONFIRM'];

async function confirm(context, coupon) {
  context.chatStates[context.chatId] = { state: 'COUPON_CONFIRM', coupon };
  await sendTelegramKeyboard(context.chatId,
    `${couponSummary(coupon)}\n\n¿Seguro que deseas usarlo?`, [[CONFIRM], [CANCEL]], context.botToken);
}

module.exports = {
  canHandle: (command, state) => command === '/confirmar_cupon' || states.includes(state?.state),
  execute: async context => {
    const { chatId, userCommand, botToken, chatStates, req } = context;
    if (userCommand === '/cancelar' || userCommand === CANCEL) {
      delete chatStates[chatId];
      await removeTelegramKeyboard(chatId, 'Operación cancelada. No se canjeó ningún cupón.', botToken);
      return;
    }
    if (userCommand === '/confirmar_cupon') {
      chatStates[chatId] = { state: 'COUPON_CODE' };
      await sendTelegramMessage(chatId, 'Introduce el código del cupón, con o sin SDB-.\nPuedes cancelar con /cancelar.', botToken);
      return;
    }
    const state = chatStates[chatId];
    if (state.state === 'COUPON_CODE') {
      const code = normalizeCode(req.body.message?.text);
      if (!code) {
        await sendTelegramMessage(chatId, 'Código inválido. Ejemplo: SDB-OCT26 u OCT26. Usa solo letras y números, sin espacios internos.\n/cancelar para salir.', botToken);
        return;
      }
      chatStates[chatId] = { state: 'COUPON_PHONE', code };
      await sendTelegramMessage(chatId, 'Introduce el teléfono donde llegó el cupón, incluyendo el prefijo. Ejemplo: 04240001122.\n/cancelar para salir.', botToken);
      return;
    }
    if (state.state === 'COUPON_PHONE') {
      const phone = normalizePhone(req.body.message?.text);
      if (!phone) {
        await sendTelegramMessage(chatId, 'Teléfono inválido. Usa 11 dígitos, por ejemplo 04240001122, o +58 424 000 1122.\n/cancelar para salir.', botToken);
        return;
      }
      let coupon;
      try {
        coupon = await lookupCoupon(state.code, phone);
      } catch (error) {
        logEvent('coupon_lookup_failed', errorDetails(error));
        await sendTelegramMessage(chatId, `${error instanceof CouponError ? error.message : 'No se pudo consultar la planilla. Intenta otra vez.'}\nEnvía nuevamente el teléfono o /cancelar.`, botToken);
        return;
      }
      await confirm(context, coupon);
      return;
    }
    if (state.state === 'COUPON_CONFIRM') {
      if (userCommand !== CONFIRM || !req.body.callback_query) {
        await confirm(context, state.coupon);
        return;
      }
      let result;
      try {
        result = await redeemCoupon(state.coupon, req.body.callback_query.from.id);
      } catch (error) {
        logEvent('coupon_redemption_failed', errorDetails(error));
        delete chatStates[chatId];
        await removeTelegramKeyboard(chatId,
          `${error instanceof CouponError ? error.message : 'No se pudo verificar el canje. Revisa la planilla antes de reintentar.'}\nInicia /confirmar_cupon para consultar de nuevo.`, botToken);
        return;
      }
      if (result.changed) {
        await sendTelegramMessage(chatId, 'El cupón cambió. Revisa los datos actualizados antes de confirmar.', botToken);
        await confirm(context, result.coupon);
        return;
      }
      delete chatStates[chatId];
      await removeTelegramKeyboard(chatId,
        `✅ Cupón usado correctamente.\n${couponSummary(result.coupon)}\nFecha de uso: ${result.usedAt}`, botToken);
    }
  }
};
