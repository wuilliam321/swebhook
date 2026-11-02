process.env.PORT = '8000';
process.env.TELEGRAM_TOKEN = '123456:test';
process.env.TELEGRAM_TOKEN_SEPTIMODIABOUTIQUE_BOT = '123456:test';
jest.mock('axios', () => ({ default: { post: jest.fn() } }));
jest.mock('../../src/api/reimbursement', () => ({ ...jest.requireActual('../../src/api/reimbursement'), getEmployees: jest.fn(), getOptions: jest.fn(), downloadPhoto: jest.fn(), uploadReceipt: jest.fn(), extractReceipt: jest.fn(), appendReimbursement: jest.fn() }));
jest.mock('../../src/api/firebase', () => ({ getReminders: jest.fn() }));
jest.mock('../../src/api/asistencia', () => ({ callAsistenciaAPI: jest.fn() }));
jest.mock('../../src/api/spending', () => ({ callSpendingAPI: jest.fn() }));
jest.mock('../../src/api/inventory');
jest.mock('../../src/api/pagoMovil');

const axios = require('axios').default;
const app = require('../../src/app');
const { sessions, updates, sessionFor } = require('../../src/conversations');
const reimbursement = require('../../src/api/reimbursement');
const { getReminders } = require('../../src/api/firebase');
const { callAsistenciaAPI } = require('../../src/api/asistencia');
const { callSpendingAPI } = require('../../src/api/spending');
const { callSalesReportAPI, callDepositoLookupAPI } = require('../../src/api/inventory');
const { callCierreAPI } = require('../../src/api/pagoMovil');
const { commandQueue, getCurrentJob } = require('../../src/queue');
const handler = app._router.stack.find(layer => layer.route?.path === '/telegram').route.stack[0].handle;
let sequence;
let sent;
const session = (user = 1, chat = -100) => sessionFor('123456', chat, user);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function send(text, user = 1, extra = {}) {
  const body = { update_id: ++sequence, message: { message_id: ++sequence, from: { id: user }, chat: { id: -100, type: 'supergroup' }, text, ...extra } };
  return dispatch(body);
}
async function dispatch(body, params = {}) {
  const response = { status(code) { this.code = code; return this; }, send() { return this; } };
  await handler({ body, params }, response);
  return response.code;
}
async function click(index, user = 1, prompt = session(user).prompt) {
  return dispatch({ update_id: ++sequence, callback_query: { id: String(++sequence), from: { id: user },
    message: { chat: { id: -100, type: 'supergroup' }, message_id: prompt.messageId }, data: `flow:${prompt.id}:${index}` } });
}
const reply = (text, user = 1, extra = {}) => send(text, user, { reply_to_message: { message_id: session(user).prompt?.messageId }, ...extra });

beforeEach(async () => {
  await flush();
  expect(getCurrentJob()).toBeNull();
  sessions.clear(); updates.clear(); commandQueue.length = 0;
  sequence = 0; sent = [];
  jest.clearAllMocks();
  axios.post.mockImplementation(async (url, payload) => {
    if (url.endsWith('/sendMessage')) {
      const message_id = ++sequence;
      sent.push({ ...payload, message_id });
      return { data: { result: { message_id } } };
    }
    return { data: { result: true } };
  });
  reimbursement.getEmployees.mockResolvedValue(['Ana', 'Maryory']);
  getReminders.mockResolvedValue(['Caja', 'Luces']);
  callAsistenciaAPI.mockResolvedValue({ success: true, message: 'Registrada' });
  callSpendingAPI.mockResolvedValue({ success: true, message: 'Registrado' });
  callSalesReportAPI.mockResolvedValue({ success: true, data: 'Reporte' });
  callDepositoLookupAPI.mockResolvedValue({ success: true, data: {} });
  callCierreAPI.mockResolvedValue({ success: true, message: 'Cierre' });
});

test('tres personas completan asistencia simultáneamente sin compartir estado', async () => {
  await Promise.all([1, 2, 3].map(user => send('/marcar', user)));
  await Promise.all([1, 2, 3].map(user => click(0, user)));
  await Promise.all([1, 2, 3].map(user => click(user === 2 ? 1 : 0, user)));
  await Promise.all([1, 2, 3].map(user => click(3, user)));
  await Promise.all([1, 2, 3].map(user => click(1, user)));
  for (let i = 0; i < 8; i++) await flush();
  expect(callAsistenciaAPI).toHaveBeenCalledTimes(3);
  expect(callAsistenciaAPI).toHaveBeenCalledWith('Ana', 'History', '🌙 Salida', 'Cierra: No');
  for (const user of [1, 2, 3]) expect(session(user).state).toBeUndefined();
  expect(sent.every(message => !message.reply_markup?.keyboard)).toBe(true);
});

test('botón ajeno, antiguo y dos confirmaciones paralelas no saltan pasos', async () => {
  await send('/marcar');
  const old = session().prompt;
  await click(0, 2, old);
  expect(session().state.state).toBe('WAITING_FOR_EMPLOYEE_NAME');
  expect(session(2).state).toBeUndefined();
  await Promise.all([click(0, 1, old), click(1, 1, old)]);
  expect(session().state.state).toBe('WAITING_FOR_STORE');
  await click(0, 1, old);
  expect(session().state.state).toBe('WAITING_FOR_STORE');
});

test('marcar pregunta directamente, retira botones usados y limpia el teclado al terminar', async () => {
  await send('/marcar');
  expect(sent).toHaveLength(1);
  expect(sent[0].text).toContain('Selecciona tu nombre');
  expect(sent[0].reply_markup.inline_keyboard).toBeDefined();
  for (const index of [0, 0, 0, 1]) {
    const prompt = session().prompt;
    await click(index);
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/editMessageReplyMarkup'), {
      chat_id: -100, message_id: prompt.messageId, reply_markup: { inline_keyboard: [] }
    }, { timeout: 15000 });
  }
  await flush();
  expect(session().state).toBeUndefined();
  expect(sent.at(-1).reply_markup).toEqual({ remove_keyboard: true });
});

test('texto sin reply o reply antiguo no modifica operación; multimedia y texto vigente sí', async () => {
  await send('/gasto');
  const old = session().prompt.messageId;
  await send('100 taxi');
  expect(callSpendingAPI).not.toHaveBeenCalled();
  await reply('', 1, { photo: [{ file_id: 'photo' }] });
  expect(session().state.pendingFileId).toBe('photo');
  await send('100 taxi', 1, { reply_to_message: { message_id: old } });
  expect(callSpendingAPI).not.toHaveBeenCalled();
  await reply('100 taxi');
  await flush();
  expect(callSpendingAPI).toHaveBeenCalledWith(expect.stringContaining('100 taxi'), undefined, { fileId: 'photo', mediaType: 'photo' });
});

test('un nuevo comando reemplaza la operación propia sin pedir confirmación', async () => {
  await send('/marcar');
  const previous = session().prompt;
  const previousOperation = session().operationId;
  await send('/gasto');
  expect(session().state.state).toBe('WAITING_FOR_AMOUNT');
  expect(session().operationId).not.toBe(previousOperation);
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/editMessageReplyMarkup'), {
    chat_id: -100, message_id: previous.messageId,
    reply_markup: { inline_keyboard: [] }
  }, { timeout: 15000 });
  await click(0, 1, previous);
  expect(session().state.state).toBe('WAITING_FOR_AMOUNT');
  expect(sent.some(message => message.text.includes('operación pendiente'))).toBe(false);
});

test('repetir marcar reinicia solo al usuario que lo envía, incluso con actualizaciones paralelas', async () => {
  await Promise.all([send('/marcar', 1), send('/marcar', 2)]);
  await Promise.all([click(0, 1), click(1, 2)]);
  const otherState = session(2).state;
  const otherPrompt = session(2).prompt;
  const oldPrompt = session(1).prompt;
  await Promise.all([send('/marcar', 1), send('/marcar', 1)]);
  expect(session(1).state.state).toBe('WAITING_FOR_EMPLOYEE_NAME');
  expect(session(2).state).toBe(otherState);
  expect(session(2).prompt).toBe(otherPrompt);
  const current = session(1).prompt;
  await click(0, 1, oldPrompt);
  expect(session(1).prompt).toBe(current);
  await click(0, 1);
  expect(session(1).state.state).toBe('WAITING_FOR_STORE');
  expect(session(2).prompt).toBe(otherPrompt);
});

test('un callback vencido no bloquea una selección válida ni genera reintentos del webhook', async () => {
  await send('/marcar');
  const post = axios.post.getMockImplementation();
  axios.post.mockImplementation(async (url, payload) => {
    if (url.endsWith('/answerCallbackQuery')) {
      throw Object.assign(new Error('query is too old'), { response: { status: 400 } });
    }
    return post(url, payload);
  });
  expect(await click(0)).toBe(200);
  expect(session().state.state).toBe('WAITING_FOR_STORE');
});

test('marcar permite empezar de nuevo después de un fallo al enviar una pregunta', async () => {
  await send('/marcar');
  const old = session().prompt;
  const post = axios.post.getMockImplementation();
  axios.post.mockImplementation(async (url, payload) => {
    if (url.endsWith('/sendMessage')) {
      throw Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
    }
    return post(url, payload);
  });
  expect(await click(0)).toBe(500);
  axios.post.mockImplementation(post);
  expect(await send('/marcar')).toBe(200);
  expect(session().state.state).toBe('WAITING_FOR_EMPLOYEE_NAME');
  const current = session().prompt;
  await click(0, 1, old);
  expect(session().prompt).toBe(current);
});

test.each([false, true])('reembolso termina tarde (error=%s) sin borrar nuevo /marcar', async fail => {
  let finish;
  reimbursement.getOptions.mockResolvedValue({ reasons: ['Taxi'], accounts: ['BS Pago Movil'], employees: ['Ana'] });
  reimbursement.downloadPhoto.mockResolvedValue(Buffer.from('image'));
  reimbursement.uploadReceipt.mockResolvedValue('https://private/receipt');
  reimbursement.extractReceipt.mockResolvedValue({ date: '01/01/2026', amount: 1, currency: 'USD', reason: 'Taxi' });
  reimbursement.appendReimbursement.mockImplementation(() => new Promise((resolve, reject) => { finish = () => fail ? reject(new Error('Sheets failed')) : resolve(); }));
  await send('/solicitar_reembolso');
  await reply('', 1, { photo: [{ file_id: 'receipt' }] });
  await flush();
  const employee = click(0);
  await flush();
  expect(finish).toBeDefined();
  // Saving must not hold the session transition lock.
  await send('/marcar');
  await click(1);
  const current = session().state;
  finish();
  await employee;
  await flush();
  expect(session().state).toBe(current);
  expect(session().state.state).toBe('WAITING_FOR_STORE');
  await click(1);
  expect(session().state.state).toBe('WAITING_FOR_ASISTENCIA_ACTION');
});

test('update duplicado en curso comparte ejecución', async () => {
  let finish;
  reimbursement.getEmployees.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const body = { update_id: 100, message: { message_id: 101, from: { id: 1 }, chat: { id: -100 }, text: '/marcar' } };
  const first = dispatch(body);
  const second = dispatch(body);
  await flush();
  finish(['Ana']);
  expect(await first).toBe(200); expect(await second).toBe(200);
  expect(reimbursement.getEmployees).toHaveBeenCalledTimes(1);
  expect(sent).toHaveLength(1);
});

test('comandos report, deposito y cierre conservan trabajo API', async () => {
  await send('/report'); await reply('3'); await flush();
  expect(callSalesReportAPI).toHaveBeenCalledWith('3');
  await send('/deposito'); await reply('DEP123'); await flush();
  expect(callDepositoLookupAPI).toHaveBeenCalledWith('DEP123');
  await send('/cierre_wuilliam'); await flush();
  expect(callCierreAPI).toHaveBeenCalledWith('wuilliam', true);
});

test('bots distintos requieren ruta explícita y nunca comparten sesión ni dedup', async () => {
  const { BOT_TOKENS } = require('../../src/config');
  BOT_TOKENS.other = '987654:other';
  try {
    const body = { update_id: 500, message: { message_id: 501, from: { id: 1 }, chat: { id: -100 }, text: '/marcar' } };
    expect(await dispatch(body)).toBe(500);
    // Failed ambiguous routes must not claim the actual bot update.
    updates.clear();
    expect(await dispatch(body, { bot: 'septimodiaboutique_bot' })).toBe(200);
    expect(await dispatch(body, { bot: 'other' })).toBe(200);
    expect(session().state).not.toBe(sessionFor('987654', -100, 1).state);
    expect(reimbursement.getEmployees).toHaveBeenCalledTimes(2);
  } finally { delete BOT_TOKENS.other; }
});

test('confirmaciones simultáneas solo responden un recordatorio; fallo API no afecta otra persona', async () => {
  await send('/marcar'); await click(0); await click(0); await click(3); await click(0);
  const firstReminder = session().prompt;
  expect(session().state.state).toBe('WAITING_FOR_REMINDER_CONFIRMATION');
  await Promise.all([click(0, 1, firstReminder), click(0, 1, firstReminder)]);
  expect(session().state.reminderAnswers).toHaveLength(1);
  expect(session().state.pendingReminders).toEqual(['Luces']);
  await send('/marcar', 2);
  const other = session(2).state;
  callAsistenciaAPI.mockResolvedValueOnce({ success: false, message: 'API unavailable' });
  await click(0); await flush();
  expect(session(2).state).toBe(other);
  expect(sent.some(message => message.text.includes('API unavailable'))).toBe(true);
});
