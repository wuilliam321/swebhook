jest.mock('axios', () => ({ default: { post: jest.fn() } }));
const axios = require('axios').default;
const { sendErrorNotice, flushErrorNotices, failureReason, pendingNotices, sentReferences } = require('../../src/api/errorNotices');
const { conversationContext, sessionFor, newOperation, sessions } = require('../../src/conversations');

beforeEach(() => {
  jest.useFakeTimers();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { result: { message_id: 1 } } });
  pendingNotices.clear(); sentReferences.clear(); sessions.clear();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('aviso de error no reemplaza botones ni la pregunta vigente, ni se repite por update', async () => {
  const session = sessionFor('bot', 1, 1);
  newOperation(session);
  const prompt = { id: 'original', messageId: 20, values: ['Sí'] };
  session.prompt = prompt;
  await conversationContext.run({ session, operationId: session.operationId, updateId: 30 }, async () => {
    await sendErrorNotice(1, 'Falló la pregunta. No se guardó nada.', 'bot:synthetic');
    await sendErrorNotice(1, 'Falló la pregunta. No se guardó nada.', 'bot:synthetic');
  });
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/sendMessage'), {
    chat_id: 1, text: '⚠️ Falló la pregunta. No se guardó nada.\nReferencia: 30'
  }, { timeout: 15000 });
  expect(session.prompt).toBe(prompt);
});

test('aviso pendiente respeta retry_after y se entrega cuando Telegram vuelve', async () => {
  axios.post.mockRejectedValueOnce({ response: { status: 429, data: { parameters: { retry_after: 7 } } } });
  await sendErrorNotice(1, 'Prueba', 'bot:synthetic', 'ref');
  expect(pendingNotices.size).toBe(1);
  await jest.advanceTimersByTimeAsync(6999);
  expect(axios.post).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(pendingNotices.size).toBe(0);
});

test('después de tres fallos conserva el aviso y lo recupera con actividad del chat correcto', async () => {
  axios.post.mockRejectedValue(new Error('offline'));
  await sendErrorNotice(1, 'Prueba', 'bot:synthetic', 'ref');
  await jest.advanceTimersByTimeAsync(10000);
  expect(axios.post).toHaveBeenCalledTimes(3);
  expect(pendingNotices.size).toBe(1);
  axios.post.mockResolvedValue({ data: { result: {} } });
  flushErrorNotices(2, 'bot:synthetic');
  flushErrorNotices(1, 'other:synthetic');
  expect(axios.post).toHaveBeenCalledTimes(3);
  flushErrorNotices(1, 'bot:synthetic');
  await Promise.resolve();
  expect(axios.post).toHaveBeenCalledTimes(4);
  expect(pendingNotices.size).toBe(0);
});

test('la razón es comprensible y no incluye excepciones ni credenciales', () => {
  const error = Object.assign(new Error('https://private token=secret'), { service: 'telegram', cause: {
    code: 'ECONNABORTED', config: { headers: { Authorization: 'secret' } }
  } });
  expect(failureReason(error)).toBe('Telegram no respondió a tiempo');
  expect(failureReason(new Error('secret'))).not.toContain('secret');
});
