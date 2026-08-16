const axios = require('axios').default;
const { OPENAI_API_KEY, OPENAI_EXPENSE_MODEL, EXPENSE_TIMEZONE } = require('./config');

const REASONS = ['Alquiler', 'Condominio', 'Servicios (Luz, Internet)', 'Impuestos', 'Marketing', 'Sueldos', 'Transporte Empleados', 'Contador', 'Transferencia UY', 'Mantenimiento', 'Suministros', 'Fletes / Delivery', 'Capacitación', 'Fashion Buyer', 'Envíos', 'Otro'];
const ACCOUNTS = ['$ Efectivo', 'BS Pago Movil', 'BS Pago Movil Gilza', 'Zelle Wuilliam', 'Binance', 'Paypal', 'BS Punto', 'BS Credito', 'Cashea Abonos', 'Cashea Cuotas', 'Otro', 'OCA Blue', 'OCA Wuilliam', 'OCA Gilza', 'Santander Wuilliam', 'Itau Wuilliam', 'Itau Gilza'];
const BS_ACCOUNTS = new Set(['BS Pago Movil', 'BS Pago Movil Gilza', 'BS Punto', 'BS Credito', 'Cashea Abonos', 'Cashea Cuotas']);
const USD_ACCOUNTS = new Set(['$ Efectivo', 'Zelle Wuilliam', 'Binance', 'Paypal']);

function venezuelaDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: EXPENSE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function validateExpense(draft) {
    const missing = [];
    if (!(Number(draft.amount) > 0)) missing.push('monto');
    if (!['USD', 'VES'].includes(draft.currency)) missing.push('moneda');
    if (!REASONS.includes(draft.reason) || draft.reason === 'Otro' && !draft.reasonConfirmed) missing.push('motivo');
    if (!ACCOUNTS.includes(draft.account)) missing.push('cuenta');
    if (!draft.date || Number.isNaN(Date.parse(`${draft.date}T12:00:00Z`))) draft.date = venezuelaDate();
    if (draft.account && draft.currency === 'USD' && BS_ACCOUNTS.has(draft.account)) missing.push('cuenta');
    if (draft.account && draft.currency === 'VES' && USD_ACCOUNTS.has(draft.account)) missing.push('cuenta');
    draft.amount = Number(draft.amount);
    draft.exchangeRate = Number(draft.exchangeRate) > 0 && draft.exchangeRateProvided ? Number(draft.exchangeRate) : null;
    draft.description = String(draft.description || '').trim();
    if (!draft.description) draft.description = 'Gasto';
    return [...new Set(missing)];
}

function questionFor(field) {
    return { monto: '¿Cuál fue el monto y la moneda?', moneda: '¿Fue en dólares o bolívares?', motivo: '¿Cuál fue el motivo del gasto?', cuenta: '¿Con qué cuenta pagaste?' }[field];
}

async function extractExpense(text, defaultStore = 'Ambas', previousDraft) {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY no está configurada');
    const schema = { type: 'object', additionalProperties: false, required: ['date', 'amount', 'currency', 'exchangeRate', 'exchangeRateProvided', 'reason', 'account', 'description', 'reasonConfirmed', 'store'], properties: {
        date: { type: ['string', 'null'] }, amount: { type: ['number', 'null'] }, currency: { type: ['string', 'null'], enum: ['USD', 'VES', null] }, exchangeRate: { type: ['number', 'null'] }, exchangeRateProvided: { type: 'boolean' }, reason: { type: ['string', 'null'], enum: [...REASONS, null] }, account: { type: ['string', 'null'], enum: [...ACCOUNTS, null] }, description: { type: ['string', 'null'] }, reasonConfirmed: { type: 'boolean' }, store: { type: ['string', 'null'], enum: ['History', 'Rodeo', 'Ambas', null] }
    }};
    const instructions = `Extrae un gasto venezolano. Fecha actual ${venezuelaDate()} (${EXPENSE_TIMEZONE}). Solo usa History o Rodeo si el usuario lo indica explícitamente; si dice ambas, usa Ambas; si no indica tienda usa null. No inventes monto, moneda, cuenta ni categoría. Motivos: ${REASONS.join(', ')}. Cuentas: ${ACCOUNTS.join(', ')}. Usa null si no hay evidencia. Crea descripción corta. ${previousDraft ? `Datos previos: ${JSON.stringify(previousDraft)}` : ''}`;
    const response = await axios.post('https://api.openai.com/v1/responses', { model: OPENAI_EXPENSE_MODEL, store: false, instructions, input: text, text: { format: { type: 'json_schema', name: 'expense_draft', strict: true, schema } } }, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 30000 });
    const output = response.data.output_text || response.data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    if (!output) throw new Error('La IA no devolvió un gasto estructurado');
    const extracted = JSON.parse(output);
    return { ...(previousDraft || {}), ...extracted, store: extracted.store || previousDraft?.store || defaultStore };
}

module.exports = { REASONS, ACCOUNTS, venezuelaDate, validateExpense, questionFor, extractExpense };
