const { AsyncLocalStorage } = require('async_hooks');
const { randomBytes } = require('crypto');

const conversationContext = new AsyncLocalStorage();
const sessions = new Map();
const updates = new Map();
const UPDATE_TTL = 60 * 60 * 1000;
const UPDATE_LIMIT = 10000;

function logEvent(event, extra = {}) {
  const context = conversationContext.getStore();
  console.log(JSON.stringify({ event, bot: context?.bot, chatId: context?.chatId,
    userId: context?.userId, operationId: context?.operationId, ...extra }));
}

function sessionFor(bot, chatId, userId) {
  const key = JSON.stringify([bot, chatId, userId]);
  if (!sessions.has(key)) sessions.set(key, { key, state: undefined, tail: Promise.resolve() });
  return sessions.get(key);
}

function stateView(session, operationId) {
  return new Proxy({}, {
    get: () => session.operationId === operationId ? session.state : undefined,
    set: (_, key, value) => {
      if (session.operationId !== operationId) return true;
      logEvent('state_changed', { from: session.state?.state, to: value?.state });
      session.state = value;
      return true;
    },
    deleteProperty: () => {
      if (session.operationId === operationId) {
        logEvent('state_cleared', { from: session.state?.state });
        session.state = undefined;
        session.prompt = undefined;
      }
      return true;
    }
  });
}

function newOperation(session) {
  session.operationId = randomBytes(8).toString('hex');
  session.state = undefined;
  session.prompt = undefined;
}

function promptFor(keyboard) {
  const context = conversationContext.getStore();
  if (!context || context.session.operationId !== context.operationId || !context.session.state) return null;
  const prompt = { id: randomBytes(6).toString('hex'), values: keyboard?.flat() };
  context.session.prompt = prompt;
  return prompt;
}

function rememberUpdate(key, work) {
  const now = Date.now();
  for (const [id, entry] of updates) {
    if (entry.done && now - entry.time > UPDATE_TTL) updates.delete(id);
  }
  if (updates.has(key)) return updates.get(key).promise;
  while (updates.size >= UPDATE_LIMIT) {
    const completed = [...updates].find(([, entry]) => entry.done);
    if (completed) updates.delete(completed[0]);
    else return Promise.reject(new Error('Demasiadas actualizaciones pendientes'));
  }
  const entry = { time: now, done: false };
  entry.promise = Promise.resolve().then(work).finally(() => { entry.done = true; entry.time = Date.now(); });
  updates.set(key, entry);
  return entry.promise;
}

async function serial(session, work) {
  const pending = session.tail.then(work);
  session.tail = pending.catch(() => {});
  return pending;
}

module.exports = { conversationContext, sessions, updates, sessionFor, stateView, newOperation,
  promptFor, logEvent, rememberUpdate, serial };
