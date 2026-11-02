const { sessions, updates, sessionFor, stateView, newOperation, rememberUpdate, conversationContext } = require('../../src/conversations');
const { sanitize } = require('../../src/logger');

beforeEach(() => { sessions.clear(); updates.clear(); });

test('estado de bot/chat/usuario independiente; finalización vieja no borra ni reemplaza nueva', () => {
  const session = sessionFor('bot1', 1, 1);
  newOperation(session);
  const old = stateView(session, session.operationId);
  old[1] = { state: 'OLD' };
  newOperation(session);
  const current = stateView(session, session.operationId);
  current[1] = { state: 'NEW' };
  delete old[1]; old[1] = { state: 'STALE' };
  expect(current[1].state).toBe('NEW');
  expect(old[1]).toBeUndefined();
  expect(sessionFor('bot2', 1, 1).state).toBeUndefined();
  expect(sessionFor('bot1', 2, 1).state).toBeUndefined();
  expect(sessionFor('bot1', 1, 2).state).toBeUndefined();
});

test('dedup TTL y límite conservan ejecución en curso', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1);
  const work = jest.fn().mockResolvedValue('ok');
  await rememberUpdate('bot:1', work);
  await rememberUpdate('bot:1', work);
  expect(work).toHaveBeenCalledTimes(1);
  now.mockReturnValue(3600002);
  await rememberUpdate('bot:1', work);
  expect(work).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 10000; i++) updates.set(`other:${i}`, { done: true, time: 3600002 });
  await rememberUpdate('new', work);
  expect(updates.size).toBeLessThanOrEqual(10000);
  now.mockRestore();
});

test('logs no exponen tokens, URLs de comprobantes ni configuración Axios', () => {
  const error = new Error('secret');
  error.config = { headers: { Authorization: 'secret' } };
  expect(JSON.stringify(sanitize(error))).not.toContain('secret');
  expect(sanitize('123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 https://files/receipt.jpg?secret=yes'))
    .toBe('[TOKEN] [URL]');
  expect(sanitize({ botToken: 'secret', imageUrl: 'private', operationId: 'abc' })).toEqual({ operationId: 'abc' });
});

test('trabajos conservan snapshot e identidad de operación', () => {
  const { enqueueJob, commandQueue } = require('../../src/queue');
  const job = { pieces: { top: 'original' } };
  conversationContext.run({ operationId: 'op', userId: 7 }, () => enqueueJob(job));
  job.pieces.top = 'changed';
  expect(commandQueue.pop()).toEqual({ pieces: { top: 'original' }, operationId: 'op', userId: 7 });
});
