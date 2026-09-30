const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios').default;
const SftpClient = require('ssh2-sftp-client');
const { accessToken } = require('./sheetsExpenses');
const {
    REIMBURSEMENTS_SPREADSHEET_ID,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    SSH_HOST,
    SSH_USER,
    SSH_KEY_PATH,
    SSH_PRIVATE_KEY,
    SSH_PASSPHRASE,
    SSH_DEST_PATH,
    IMAGE_BASE_URL
} = require('../config');

const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${REIMBURSEMENTS_SPREADSHEET_ID}`;
const cacheDuration = 24 * 60 * 60 * 1000;
let optionsCache;
let optionsRequest;
let employeesCache;
let employeesRequest;
let headersReadyUntil = 0;
let headersRequest;
let sheetIdCache;
let sheetIdRequest;
let reimbursementWrite = Promise.resolve();

async function downloadPhoto(fileId, botToken) {
    const file = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, { params: { file_id: fileId } });
    const { file_path: filePath, file_size: fileSize } = file.data.result || {};
    if (!filePath || fileSize > 10 * 1024 * 1024) throw new Error('El comprobante no está disponible o supera 10 MB');
    const response = await axios.get(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
        responseType: 'arraybuffer',
        maxContentLength: 10 * 1024 * 1024
    });
    const image = Buffer.from(response.data);
    if (!image.length || image.length > 10 * 1024 * 1024) throw new Error('Tamaño de comprobante inválido');
    return image;
}

async function getOptions() {
    if (optionsCache && Date.now() < optionsCache.expiresAt) return optionsCache.value;
    if (!optionsRequest) {
        optionsRequest = (async () => {
            const token = await accessToken();
            const ranges = ['Cuentas!E:E', 'Cuentas!K:K'];
            const requests = ranges.map(range => axios.get(`${sheetUrl}/values/${encodeURIComponent(range)}`, {
                headers: { Authorization: `Bearer ${token}` }
            }));
            const [responses, employees] = await Promise.all([Promise.all(requests), getEmployees(token)]);
            const values = responses.map(response => response.data.values?.flat().map(value => String(value).trim()).filter(Boolean) || []);
            const value = {
                reasons: values[0].filter(item => item.toLowerCase() !== 'motivo'),
                accounts: values[1].filter(item => item.toLowerCase() !== 'cuenta egreso'),
                employees
            };
            optionsCache = { value, expiresAt: Date.now() + cacheDuration };
            return value;
        })().finally(() => { optionsRequest = null; });
    }
    return optionsRequest;
}

async function getEmployees(token) {
    if (employeesCache && Date.now() < employeesCache.expiresAt) return employeesCache.value;
    if (!employeesRequest) {
        employeesRequest = (async () => {
            const access = token || await accessToken();
            const response = await axios.get(`${sheetUrl}/values/${encodeURIComponent('Cuentas!M:M')}`, {
                headers: { Authorization: `Bearer ${access}` }
            });
            const value = (response.data.values || []).flat().map(item => String(item).trim())
                .filter(item => item && item.toLowerCase() !== 'empleados');
            employeesCache = { value, expiresAt: Date.now() + cacheDuration };
            return value;
        })().finally(() => { employeesRequest = null; });
    }
    return employeesRequest;
}

function normalizeDate(value) {
    const text = String(value || '').trim();
    const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!local && !iso) return '';
    const [day, month, year] = local
        ? [Number(local[1]), Number(local[2]), Number(local[3])]
        : [Number(iso[3]), Number(iso[2]), Number(iso[1])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function normalizeAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    const raw = String(value || '').trim().replace(/\s/g, '');
    if (!/^[\d.,]+$/.test(raw)) return null;
    const comma = raw.lastIndexOf(',');
    const period = raw.lastIndexOf('.');
    const decimal = Math.max(comma, period);
    const normalized = decimal >= 0 && raw.length - decimal <= 3
        ? `${raw.slice(0, decimal).replace(/[.,]/g, '')}.${raw.slice(decimal + 1)}`
        : raw.replace(/[.,]/g, '');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function canonical(value, options) {
    return options.find(option => option.toLocaleLowerCase('es') === String(value || '').trim().toLocaleLowerCase('es')) || '';
}

async function extractReceipt(image, caption, reasons) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está configurada');
    const prompt = `Extrae datos de este comprobante para solicitar un reembolso. Responde solo JSON con {"date":"DD/MM/YYYY o vacío","amount":número o null,"currency":"USD, VES o vacío","reason":"una opción exacta o vacío","description":"texto breve"}. Motivos permitidos: ${JSON.stringify(reasons)}. Usa solo datos visibles; no inventes fecha, monto ni moneda. La descripción debe incluir destinatario, concepto y referencia cuando aparezcan. Texto adicional del usuario: ${caption || '(ninguno)'}.`;
    const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } }] }],
        generationConfig: { responseMimeType: 'application/json' }
    }, { headers: { 'x-goog-api-key': GEMINI_API_KEY }, timeout: 120000 });
    const output = response.data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (!output) throw new Error('Gemini no devolvió datos del comprobante');
    const data = JSON.parse(output);
    return {
        date: normalizeDate(data.date),
        amount: normalizeAmount(data.amount),
        currency: ['USD', 'VES'].includes(String(data.currency || '').toUpperCase()) ? String(data.currency).toUpperCase() : '',
        reason: canonical(data.reason, reasons),
        description: String(data.description || '').trim() || String(caption || '').trim() || 'Solicitud de reembolso'
    };
}

async function uploadReceipt(image) {
    if (!SSH_HOST || !SSH_USER || !SSH_DEST_PATH || !IMAGE_BASE_URL) {
        throw new Error('Almacenamiento de comprobantes no configurado');
    }
    const filename = `${crypto.randomUUID()}.jpg`;
    const directory = path.posix.join(SSH_DEST_PATH, 'reembolsos');
    const sftp = new SftpClient();
    try {
        await sftp.connect({
            host: SSH_HOST,
            username: SSH_USER,
            privateKey: SSH_PRIVATE_KEY || fs.readFileSync(path.resolve(SSH_KEY_PATH || '7dbimages.pem')),
            passphrase: SSH_PASSPHRASE
        });
        await sftp.mkdir(directory, true);
        await sftp.put(image, path.posix.join(directory, filename));
    } finally {
        await sftp.end();
    }
    const baseUrl = IMAGE_BASE_URL.endsWith('/') ? IMAGE_BASE_URL : `${IMAGE_BASE_URL}/`;
    return new URL(`reembolsos/${filename}`, baseUrl).toString();
}

async function ensureHeaders(token) {
    if (Date.now() < headersReadyUntil) return;
    if (!headersRequest) {
        headersRequest = (async () => {
            const headers = { Authorization: `Bearer ${token}` };
            for (const [cell, expected] of [['K1', 'Comprobante'], ['L1', 'Empleada(o)']]) {
                const headerUrl = `${sheetUrl}/values/${encodeURIComponent(`Reembolsos!${cell}`)}`;
                const header = await axios.get(headerUrl, { headers });
                const currentHeader = header.data.values?.[0]?.[0];
                if (currentHeader && currentHeader !== expected) throw new Error(`Reembolsos!${cell} ya contiene otro encabezado`);
                if (!currentHeader) {
                    await axios.put(headerUrl, { values: [[expected]] }, {
                        headers,
                        params: { valueInputOption: 'RAW' }
                    });
                }
            }
            headersReadyUntil = Date.now() + cacheDuration;
        })().finally(() => { headersRequest = null; });
    }
    await headersRequest;
}

async function getSheetId(token) {
    if (sheetIdCache && Date.now() < sheetIdCache.expiresAt) return sheetIdCache.value;
    if (!sheetIdRequest) {
        sheetIdRequest = (async () => {
            const response = await axios.get(sheetUrl, {
                headers: { Authorization: `Bearer ${token}` },
                params: { fields: 'sheets(properties(sheetId,title))' }
            });
            const sheetId = response.data.sheets?.find(sheet => sheet.properties?.title === 'Reembolsos')?.properties?.sheetId;
            if (sheetId === undefined) throw new Error('No existe la pestaña Reembolsos');
            sheetIdCache = { value: sheetId, expiresAt: Date.now() + cacheDuration };
            return sheetId;
        })().finally(() => { sheetIdRequest = null; });
    }
    return sheetIdRequest;
}

async function appendReimbursement(draft, imageUrl) {
    const pending = reimbursementWrite.then(() => writeReimbursement(draft, imageUrl));
    reimbursementWrite = pending.catch(() => {});
    return pending;
}

async function writeReimbursement(draft, imageUrl) {
    const token = await accessToken();
    const headers = { Authorization: `Bearer ${token}` };
    await ensureHeaders(token);
    const sheetId = await getSheetId(token);
    const response = await axios.get(`${sheetUrl}/values/${encodeURIComponent('Reembolsos!A2:C')}`, {
        headers,
        params: { valueRenderOption: 'FORMULA' }
    });
    const rows = response.data.values || [];
    const firstEmpty = rows.findIndex(row => !row[0]);
    const rowIndex = firstEmpty < 0 ? rows.length + 1 : firstEmpty + 1;
    const existingUsd = rows[rowIndex - 1]?.[2];
    const columns = [
        [0, draft.date],
        ...(draft.currency === 'USD' && !existingUsd ? [[2, draft.amount]] : []),
        ...(draft.currency === 'VES' ? [[3, draft.amount]] : []),
        [4, draft.reason], [5, draft.account], [6, draft.description],
        [10, imageUrl], [11, draft.employee]
    ];
    await axios.post(`${sheetUrl}:batchUpdate`, {
        requests: columns.map(([columnIndex, value]) => ({
            updateCells: {
                start: { sheetId, rowIndex, columnIndex },
                rows: [{ values: [{ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } }] }],
                fields: 'userEnteredValue'
            }
        }))
    }, { headers });
}

module.exports = { downloadPhoto, getOptions, getEmployees, extractReceipt, uploadReceipt, appendReimbursement, normalizeDate, normalizeAmount, canonical };
