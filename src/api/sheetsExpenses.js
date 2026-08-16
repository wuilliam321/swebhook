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
function isDateCell(cell) {
    if (!cell || cell.userEnteredValue?.formulaValue) return false;
    if (cell.effectiveValue?.numberValue !== undefined) {
        return ['DATE', 'DATE_TIME'].includes(cell.effectiveFormat?.numberFormat?.type);
    }
    const value = cell.effectiveValue?.stringValue || cell.formattedValue;
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function nextExpenseRow(rows) {
    let last = 0;
    rows.forEach((row, index) => { if (isDateCell(row?.values?.[0] || row)) last = index + 1; });
    return last + 1;
}

async function nextRow(token, spreadsheetId) {
    const response = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
            ranges: `${SHEET}!A:A`,
            includeGridData: true,
            fields: 'sheets(data(startRow,rowData(values(userEnteredValue,effectiveValue,effectiveFormat.numberFormat,formattedValue))))'
        }
    });
    const data = response.data.sheets?.[0]?.data?.[0] || {};
    const rows = data.rowData || [];
    const offset = data.startRow || 0;
    let last = 0;
    rows.forEach((row, index) => { if (isDateCell(row.values?.[0])) last = offset + index + 1; });
    return last + 1;
}
async function values(token, spreadsheetId, range) { return (await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${token}` } })).data.values || []; }
async function writeOne(token, spreadsheetId, draft, transactionId, store) {
    const ids = await values(token, spreadsheetId, `${SHEET}!N:N`); if (ids.some(row => row[0] === transactionId)) return { duplicate: true };
    const row = await nextRow(token, spreadsheetId);
    const record = [draft.date, draft.exchangeRate || '', draft.currency === 'USD' ? draft.amount : '', draft.currency === 'VES' ? draft.amount : '', draft.reason, draft.account, draft.description, store];
    const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const data = record.flatMap((value, index) => value === '' ? [] : [{ range: `${SHEET}!${columns[index]}${row}`, values: [[value]] }]);
    data.push({ range: `${SHEET}!N${row}`, values: [[transactionId]] });
    await axios.post(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data }, { headers: { Authorization: `Bearer ${token}` } });
    return { row };
}
async function recordExpense(draft, transactionId) { const token = await accessToken(); const targets = draft.store === 'Ambas' ? [[HISTORY_SPREADSHEET_ID, 'Ambas'], [RODEO_SPREADSHEET_ID, 'Ambas']] : [[draft.store === 'History' ? HISTORY_SPREADSHEET_ID : RODEO_SPREADSHEET_ID, draft.store]]; return Promise.all(targets.map(([id, store]) => writeOne(token, id, draft, transactionId, store))); }
module.exports = { isDateCell, nextExpenseRow, recordExpense };
