process.env.PORT = '8000';
process.env.TELEGRAM_TOKEN = '123456:test';
process.env.TELEGRAM_TOKEN_SEPTIMODIABOUTIQUE_BOT = '123456:test';
jest.mock('axios', () => ({ default: { post: jest.fn() } }));
jest.mock('../../src/api/coupons', () => ({ lookupCoupon: jest.fn(), redeemCoupon: jest.fn() }));

const axios = require('axios').default;
const app = require('../../src/app');
const { lookupCoupon, redeemCoupon } = require('../../src/api/coupons');
const { CouponError } = require('../../src/coupons');
const { sessions, updates, sessionFor } = require('../../src/conversations');
const handler = app._router.stack.find(layer => layer.route?.path === '/telegram').route.stack[0].handle;
const coupon = { code: 'SDB-OCT26', phone: '04165028307', type: 'PORCENTAJE', value: 8, expiration: '2026-12-28', row: 2 };
let sequence;
let sent;
const session = (user = 1, chat = -100) => sessionFor('123456', chat, user);

async function dispatch(body) {
  const response = { status(code) { this.code = code; return this; }, send() { return this; } };
  await handler({ body }, response);
  return response.code;
}

function send(text, user = 1, extra = {}, chat = -100) {
  return dispatch({ update_id: ++sequence, message: { message_id: ++sequence, from: { id: user },
    chat: { id: chat, type: 'supergroup' }, text, ...extra } });
}

function reply(text, user = 1, extra = {}, chat = -100) {
  return send(text, user, { reply_to_message: { message_id: session(user, chat).prompt?.messageId }, ...extra }, chat);
}

function click(index, user = 1, prompt = session(user).prompt) {
  return dispatch({ update_id: ++sequence, callback_query: { id: String(++sequence), from: { id: user },
    message: { chat: { id: -100, type: 'supergroup' }, message_id: prompt.messageId }, data: `flow:${prompt.id}:${index}` } });
}

async function ready(user = 1) {
  await send('/confirmar_cupon', user);
  await reply(' oct26 ', user);
  await reply('+58 (416) 502-8307', user);
}

beforeEach(() => {
  sessions.clear(); updates.clear(); sequence = 0; sent = [];
  axios.post.mockImplementation(async (url, payload) => {
    if (url.endsWith('/sendMessage')) {
      const message_id = ++sequence;
      sent.push({ ...payload, message_id });
      return { data: { result: { message_id } } };
    }
    return { data: { result: true } };
  });
  lookupCoupon.mockResolvedValue(coupon);
  redeemCoupon.mockResolvedValue({ coupon, usedAt: '17/11/2026 11:00:00', userId: '1' });
});

test('flujo completo con código y teléfono normalizados, teclado y resumen', async () => {
  await ready();
  expect(lookupCoupon).toHaveBeenCalledWith('SDB-OCT26', '04165028307');
  expect(sent.at(-1).text).toContain('8%');
  expect(sent.at(-1).reply_markup.inline_keyboard.flat().map(button => button.text)).toEqual(['✅ Usar cupón', '❌ Cancelar']);
  await click(0);
  expect(redeemCoupon).toHaveBeenCalledWith(coupon, 1);
  expect(session().state).toBeUndefined();
  expect(sent.at(-1).text).toContain('usado correctamente');
  expect(sent.at(-1).text).toContain('Autorizado por: 1');
  expect(sent.at(-1).reply_markup).toEqual({ remove_keyboard: true });
});

test.each([0, 1, 2])('/cancelar funciona en paso %s', async step => {
  await send('/confirmar_cupon');
  if (step >= 1) await reply('OCT26');
  if (step >= 2) await reply('04165028307');
  await send('/cancelar');
  expect(session().state).toBeUndefined();
  expect(redeemCoupon).not.toHaveBeenCalled();
  expect(sent.at(-1).text).toContain('cancelada');
});

test('botón cancelar termina sin escribir', async () => {
  await ready(); await click(1);
  expect(session().state).toBeUndefined();
  expect(redeemCoupon).not.toHaveBeenCalled();
});

test('código inválido, foto y teléfono inválido mantienen paso', async () => {
  await send('/confirmar_cupon');
  for (const text of ['', 'SDB-', 'OCT 26', '=SUM(1)', 'OCT26@bot']) {
    await reply(text);
    expect(session().state.state).toBe('COUPON_CODE');
  }
  await reply(undefined, 1, { photo: [{ file_id: 'photo' }], caption: 'OCT26' });
  expect(session().state.state).toBe('COUPON_CODE');
  await reply('OCT26');
  for (const text of ['', '4165028307', 'tel 04165028307', '+5984165028307']) {
    await reply(text);
    expect(session().state.state).toBe('COUPON_PHONE');
  }
  expect(lookupCoupon).not.toHaveBeenCalled();
});

test('error de consulta permite corregir teléfono sin canjear', async () => {
  lookupCoupon.mockRejectedValueOnce(new CouponError('No encontramos un cupón para esos datos.'));
  await ready();
  expect(session().state.state).toBe('COUPON_PHONE');
  expect(sent.at(-1).text).toContain('No encontramos');
  await reply('04165028307');
  expect(session().state.state).toBe('COUPON_CONFIRM');
});

test('texto libre no confirma, ni siquiera texto del botón', async () => {
  await ready();
  await reply('sí');
  expect(redeemCoupon).not.toHaveBeenCalled();
  await reply('✅ Usar cupón');
  expect(redeemCoupon).not.toHaveBeenCalled();
  expect(session().state.state).toBe('COUPON_CONFIRM');
});

test('botón ajeno y antiguo no canjean; doble clic solo canjea una vez', async () => {
  await ready();
  const old = session().prompt;
  await click(0, 2, old);
  expect(redeemCoupon).not.toHaveBeenCalled();
  await send('/confirmar_cupon');
  await click(0, 1, old);
  expect(redeemCoupon).not.toHaveBeenCalled();
  await reply('OCT26'); await reply('04165028307');
  const current = session().prompt;
  await Promise.all([click(0, 1, current), click(0, 1, current)]);
  expect(redeemCoupon).toHaveBeenCalledTimes(1);
});

test('otro comando descarta cupón y su confirmación', async () => {
  await ready(); const old = session().prompt;
  await send('/consulta_codigo');
  await click(0, 1, old);
  expect(redeemCoupon).not.toHaveBeenCalled();
  expect(session().state.state).not.toBe('COUPON_CONFIRM');
});

test('usuarios y chats mantienen sesiones separadas', async () => {
  await ready();
  await send('/confirmar_cupon', 2);
  await send('/confirmar_cupon', 1, {}, -200);
  expect(session().state.state).toBe('COUPON_CONFIRM');
  expect(session(2).state.state).toBe('COUPON_CODE');
  expect(session(1, -200).state.state).toBe('COUPON_CODE');
});

test('descuento cambiado exige segunda confirmación', async () => {
  await ready();
  const changed = { ...coupon, value: 12 };
  redeemCoupon.mockResolvedValueOnce({ changed: true, coupon: changed });
  await click(0);
  expect(session().state.coupon.value).toBe(12);
  expect(sent.at(-1).text).toContain('12%');
  expect(sent.some(message => message.text.includes('usado correctamente'))).toBe(false);
});

test('fallo de escritura no anuncia éxito ni permite repetir botón', async () => {
  await ready(); const prompt = session().prompt;
  redeemCoupon.mockRejectedValueOnce(new CouponError('Canje bloqueado para verificación.'));
  await click(0); await click(0, 1, prompt);
  expect(redeemCoupon).toHaveBeenCalledTimes(1);
  expect(session().state).toBeUndefined();
  expect(sent.some(message => message.text.includes('usado correctamente'))).toBe(false);
});
