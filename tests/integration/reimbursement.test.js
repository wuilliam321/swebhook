process.env.PORT = '8000';
process.env.TELEGRAM_TOKEN = 'telegram-token';
process.env.GEMINI_API_KEY = 'gemini-key';
process.env.SSH_HOST = 'images.example.com';
process.env.SSH_USER = 'images';
process.env.SSH_PRIVATE_KEY = 'test-key';
process.env.SSH_PASSPHRASE = 'test-passphrase';
process.env.SSH_DEST_PATH = '/srv/images';
process.env.IMAGE_BASE_URL = 'https://images.example.com/';

jest.mock('axios', () => ({ default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('ssh2-sftp-client', () => jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue(),
    put: jest.fn().mockResolvedValue(),
    end: jest.fn().mockResolvedValue()
})));
jest.mock('../../src/api/sheetsExpenses', () => ({
    accessToken: jest.fn().mockResolvedValue('sheets-token'),
    recordExpense: jest.fn()
}));
jest.mock('../../src/api/telegram', () => ({
    sendTelegramMessage: jest.fn().mockResolvedValue({ success: true }),
    sendTelegramKeyboard: jest.fn().mockResolvedValue({ success: true }),
    removeTelegramKeyboard: jest.fn().mockResolvedValue({ success: true })
}));

const axios = require('axios').default;
const SftpClient = require('ssh2-sftp-client');
const app = require('../../src/app');
const { chatStates } = require('../../src/state');
const { sendTelegramMessage, sendTelegramKeyboard, removeTelegramKeyboard } = require('../../src/api/telegram');

const chatId = 725;
const cacheDuration = 24 * 60 * 60 * 1000;
let now = Date.now();
let reimbursementRows;
const telegramHandler = app._router.stack.find(layer => layer.route?.path === '/telegram').route.stack[0].handle;
const sendUpdate = message => telegramHandler({ body: { message: { chat: { id: chatId, type: 'private' }, ...message } } }, {
    status() { return this; },
    send() { return this; }
});
const waitUntil = async predicate => {
    for (let i = 0; i < 30; i++) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error('El flujo no terminó');
};

beforeEach(() => {
    jest.clearAllMocks();
    now += cacheDuration + 1;
    reimbursementRows = [['', 'helper', '=D2*2']];
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    Object.keys(chatStates).forEach(id => delete chatStates[id]);
    axios.get.mockImplementation(async url => {
        if (url.includes('/getFile')) return { data: { result: { file_path: 'photos/receipt.jpg', file_size: 4 } } };
        if (url.includes('/file/bot')) return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
        if (url.includes('Cuentas!E%3AE')) return { data: { values: [['Motivo'], ['Transporte'], ['Suministros']] } };
        if (url.includes('Cuentas!K%3AK')) return { data: { values: [['Cuenta egreso'], ['BS Pago Movil']] } };
        if (url.includes('Cuentas!M%3AM')) return { data: { values: [['Empleados'], ['Rosario'], ['Maryory']] } };
        if (url.includes('Reembolsos!K1') || url.includes('Reembolsos!L1')) return { data: {} };
        if (url.includes('Reembolsos!A2%3AC')) return { data: { values: reimbursementRows } };
        if (url.endsWith('/spreadsheets/1xIlDWHmxH4T53UTbYcAs-I1pdTeKY7nDQNyE8bOKKnk')) return { data: { sheets: [{ properties: { title: 'Reembolsos', sheetId: 1459055439 } }] } };
        throw new Error(`Unexpected GET ${url}`);
    });
    axios.put.mockResolvedValue({ data: {} });
});

afterEach(() => jest.restoreAllMocks());

test('registra comprobante, datos extraídos y URL en Reembolsos; confirma al usuario', async () => {
    let resolveExtraction;
    let extractionCount = 0;
    axios.post.mockImplementation(async url => {
        if (url.includes('generateContent')) {
            const response = { data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ date: '9/8/2026', amount: '1.234,50', currency: 'VES', reason: 'Transporte', description: 'Taxi a Rodeo, referencia 12345' }) }] } }] } };
            if (++extractionCount === 1) return new Promise(resolve => { resolveExtraction = () => resolve(response); });
            return response;
        }
        if (url.includes(':batchUpdate')) {
            const firstEmpty = reimbursementRows.findIndex(row => !row[0]);
            const index = firstEmpty < 0 ? reimbursementRows.length : firstEmpty;
            reimbursementRows[index] = ['09/08/2026', ...(reimbursementRows[index]?.slice(1) || [])];
            return { data: { replies: [{}] } };
        }
        throw new Error(`Unexpected POST ${url}`);
    });

    await sendUpdate({ text: '/solicitar_reembolso' });
    expect(chatStates[chatId].state).toBe('WAITING_REIMBURSEMENT_PHOTO');
    await sendUpdate({ photo: [{ file_id: 'small' }, { file_id: 'large' }] });
    await waitUntil(() => chatStates[chatId]?.state === 'WAITING_REIMBURSEMENT_EMPLOYEE');
    expect(sendTelegramKeyboard).toHaveBeenCalledWith(chatId, expect.stringContaining('empleada(o)'), [['Rosario', 'Maryory']], 'telegram-token');
    const extractionIndex = axios.post.mock.calls.findIndex(([url]) => url.includes('generateContent'));
    if (extractionIndex !== -1) expect(sendTelegramKeyboard.mock.invocationCallOrder[0]).toBeLessThan(axios.post.mock.invocationCallOrder[extractionIndex]);
    await sendUpdate({ text: 'Rosario' });
    expect(chatStates[chatId].state).toBe('PROCESSING_REIMBURSEMENT');
    expect(axios.post.mock.calls.some(([url]) => url.includes(':batchUpdate'))).toBe(false);
    await waitUntil(() => resolveExtraction);
    resolveExtraction();
    await waitUntil(() => chatStates[chatId] === undefined);

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/getFile'), { params: { file_id: 'large' } });
    expect(SftpClient.mock.results[0].value.connect).toHaveBeenCalledWith(expect.objectContaining({ passphrase: 'test-passphrase' }));
    expect(SftpClient.mock.results[0].value.put).toHaveBeenCalledWith(expect.any(Buffer), expect.stringMatching(/^\/srv\/images\/reembolsos\/.*\.jpg$/));
    expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('Reembolsos!K1'), { values: [['Comprobante']] }, expect.any(Object));
    expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('Reembolsos!L1'), { values: [['Empleada(o)']] }, expect.any(Object));
    const append = axios.post.mock.calls.find(([url]) => url.includes(':batchUpdate'));
    expect(append[1].requests.map(({ updateCells }) => [updateCells.start, updateCells.rows[0].values[0].userEnteredValue])).toEqual([
        [{ sheetId: 1459055439, rowIndex: 1, columnIndex: 0 }, { stringValue: '09/08/2026' }],
        [{ sheetId: 1459055439, rowIndex: 1, columnIndex: 3 }, { numberValue: 1234.5 }],
        [{ sheetId: 1459055439, rowIndex: 1, columnIndex: 4 }, { stringValue: 'Transporte' }],
        [{ sheetId: 1459055439, rowIndex: 1, columnIndex: 5 }, { stringValue: 'BS Pago Movil' }],
        [{ sheetId: 1459055439, rowIndex: 1, columnIndex: 6 }, { stringValue: 'Taxi a Rodeo, referencia 12345' }],
        [{ sheetId: 1459055439, rowIndex: 1, columnIndex: 10 }, { stringValue: expect.stringMatching(/^https:\/\/images\.example\.com\/reembolsos\/.*\.jpg$/) }],
        [{ sheetId: 1459055439, rowIndex: 1, columnIndex: 11 }, { stringValue: 'Rosario' }]
    ]);
    expect(chatStates[chatId]).toBeUndefined();
    expect(removeTelegramKeyboard).toHaveBeenCalledWith(chatId, 'Registrando solicitud.', 'telegram-token');
    expect(removeTelegramKeyboard.mock.invocationCallOrder[0]).toBeLessThan(axios.post.mock.invocationCallOrder.at(-1));
    expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('a la brevedad posible'), 'telegram-token');

    for (const elapsed of [cacheDuration - 1, cacheDuration + 1]) {
        now += elapsed;
        await sendUpdate({ text: '/solicitar_reembolso' });
        await sendUpdate({ photo: [{ file_id: 'receipt' }] });
        await waitUntil(() => chatStates[chatId]?.state === 'WAITING_REIMBURSEMENT_EMPLOYEE');
        await sendUpdate({ text: 'Rosario' });
        await waitUntil(() => chatStates[chatId] === undefined);
    }
    expect(axios.get.mock.calls.filter(([url]) => url.includes('Cuentas!')).length).toBe(6);
    expect(axios.get.mock.calls.filter(([url]) => url.includes('Reembolsos!K1') || url.includes('Reembolsos!L1')).length).toBe(4);
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith('/spreadsheets/1xIlDWHmxH4T53UTbYcAs-I1pdTeKY7nDQNyE8bOKKnk')).length).toBe(2);
    expect(axios.post.mock.calls.filter(([url]) => url.includes(':batchUpdate')).length).toBe(3);
    expect(axios.get.mock.calls.filter(([url]) => url.includes('Reembolsos!A2%3AC')).length).toBe(3);
    expect(axios.post.mock.calls.filter(([url]) => url.includes(':batchUpdate')).map(([, body]) => body.requests[0].updateCells.start.rowIndex)).toEqual([1, 2, 3]);
});

test('pide datos ausentes y no confirma cuando Sheets falla', async () => {
    axios.post.mockImplementation(async url => {
        if (url.includes('generateContent')) return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ date: '', amount: 20, currency: 'USD', reason: '', description: 'Pago a proveedor' }) }] } }] } };
        if (url.includes(':batchUpdate')) throw new Error('Sheets unavailable');
        throw new Error(`Unexpected POST ${url}`);
    });

    await sendUpdate({ text: '/solicitar_reembolso' });
    await sendUpdate({ photo: [{ file_id: 'receipt' }] });
    await waitUntil(() => chatStates[chatId]?.state === 'WAITING_REIMBURSEMENT_EMPLOYEE');
    await sendUpdate({ text: 'Desconocida' });
    expect(chatStates[chatId].state).toBe('WAITING_REIMBURSEMENT_EMPLOYEE');
    expect(removeTelegramKeyboard).not.toHaveBeenCalled();
    await sendUpdate({ text: 'Maryory' });
    await waitUntil(() => chatStates[chatId]?.state === 'WAITING_REIMBURSEMENT_DATE');
    await sendUpdate({ text: '10/08/2026' });
    expect(chatStates[chatId].state).toBe('WAITING_REIMBURSEMENT_REASON');
    expect(sendTelegramKeyboard).toHaveBeenCalledWith(chatId, expect.stringContaining('motivo'), [['Transporte', 'Suministros']], 'telegram-token');
    await sendUpdate({ text: 'Suministros' });

    const write = axios.post.mock.calls.find(([url]) => url.includes(':batchUpdate'));
    expect(write[1].requests.map(({ updateCells }) => updateCells.start.columnIndex)).toEqual([0, 4, 5, 6, 10, 11]);
    expect(chatStates[chatId]).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('No pude confirmar'), 'telegram-token');
    expect(removeTelegramKeyboard).toHaveBeenCalledTimes(1);
});
