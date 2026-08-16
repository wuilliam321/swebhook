const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios').default;
const { GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE, HISTORY_SPREADSHEET_ID, RODEO_SPREADSHEET_ID } = require('../config');
const SHEET = 'Registro de gastos';
function b64(value) { return Buffer.from(value).toString('base64url'); }
async function accessToken() {
    if (!GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE no está configurada');
    const account = JSON.parse(fs.readFileSync(GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE)); const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 300 }))}`;
    const assertion = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).end().sign(account.private_key, 'base64url')}`;
    return (await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }))).data.access_token;
}
function isDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function nextExpenseRow(values) { let last = 0; values.forEach((value, index) => { if (isDate(value)) last = index + 1; }); return last + 1; }
async function values(token, spreadsheetId, range) { return (await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${token}` } })).data.values || []; }
async function writeOne(token, spreadsheetId, draft, transactionId, store) {
    const ids = await values(token, spreadsheetId, `${SHEET}!N:N`); if (ids.some(row => row[0] === transactionId)) return { duplicate: true };
    const dates = await values(token, spreadsheetId, `${SHEET}!A:A`); const row = nextExpenseRow(dates.map(value => value[0]));
    const record = [draft.date, draft.exchangeRate || '', draft.currency === 'USD' ? draft.amount : '', draft.currency === 'VES' ? draft.amount : '', draft.reason, draft.account, draft.description, store];
    await axios.put(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${SHEET}!A${row}:H${row}`)}`, { values: [record] }, { headers: { Authorization: `Bearer ${token}` }, params: { valueInputOption: 'USER_ENTERED' } });
    await axios.put(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${SHEET}!N${row}`)}`, { values: [[transactionId]] }, { headers: { Authorization: `Bearer ${token}` }, params: { valueInputOption: 'RAW' } }); return { row };
}
async function recordExpense(draft, transactionId) { const token = await accessToken(); const targets = draft.store === 'Ambas' ? [[HISTORY_SPREADSHEET_ID, 'Ambas'], [RODEO_SPREADSHEET_ID, 'Ambas']] : [[draft.store === 'History' ? HISTORY_SPREADSHEET_ID : RODEO_SPREADSHEET_ID, draft.store]]; return Promise.all(targets.map(([id, store]) => writeOne(token, id, draft, transactionId, store))); }
module.exports = { nextExpenseRow, recordExpense };
