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
    Object.keys(chatStates).forEach(id => delete chatStates[id]);
    axios.get.mockImplementation(async url => {
        if (url.includes('/getFile')) return { data: { result: { file_path: 'photos/receipt.jpg', file_size: 4 } } };
        if (url.includes('/file/bot')) return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
        if (url.includes('Cuentas!E%3AE')) return { data: { values: [['Motivo'], ['Transporte'], ['Suministros']] } };
        if (url.includes('Cuentas!K%3AK')) return { data: { values: [['Cuenta egreso'], ['BS Pago Movil']] } };
        if (url.includes('Reembolsos!H1')) return { data: {} };
        throw new Error(`Unexpected GET ${url}`);
    });
    axios.put.mockResolvedValue({ data: {} });
});

test('registra comprobante, datos extraídos y URL en Reembolsos; confirma al usuario', async () => {
    axios.post.mockImplementation(async url => {
        if (url.includes('generateContent')) return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ date: '9/8/2026', amount: '1.234,50', currency: 'VES', reason: 'Transporte', description: 'Taxi a Rodeo, referencia 12345' }) }] } }] } };
        if (url.includes(':append')) return { data: { updates: { updatedRows: 1 } } };
        throw new Error(`Unexpected POST ${url}`);
    });

    await sendUpdate({ text: '/solicitar_reembolso' });
    expect(chatStates[chatId].state).toBe('WAITING_REIMBURSEMENT_PHOTO');
    await sendUpdate({ photo: [{ file_id: 'small' }, { file_id: 'large' }] });
    await waitUntil(() => removeTelegramKeyboard.mock.calls.length > 0);

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/getFile'), { params: { file_id: 'large' } });
    expect(SftpClient.mock.results[0].value.connect).toHaveBeenCalledWith(expect.objectContaining({ passphrase: 'test-passphrase' }));
    expect(SftpClient.mock.results[0].value.put).toHaveBeenCalledWith(expect.any(Buffer), expect.stringMatching(/^\/srv\/images\/reembolsos\/.*\.jpg$/));
    expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('Reembolsos!H1'), { values: [['Comprobante']] }, expect.any(Object));
    const append = axios.post.mock.calls.find(([url]) => url.includes(':append'));
    expect(append[0]).toContain('Reembolsos!A%3AH');
    expect(append[1].values[0]).toEqual(['09/08/2026', '', '', 1234.5, 'Transporte', 'BS Pago Movil', 'Taxi a Rodeo, referencia 12345', expect.stringMatching(/^https:\/\/images\.example\.com\/reembolsos\/.*\.jpg$/)]);
    expect(chatStates[chatId]).toBeUndefined();
    expect(removeTelegramKeyboard).toHaveBeenCalledWith(chatId, expect.stringContaining('a la brevedad posible'), 'telegram-token');
});

test('pide datos ausentes y no confirma cuando Sheets falla', async () => {
    axios.post.mockImplementation(async url => {
        if (url.includes('generateContent')) return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ date: '', amount: 20, currency: 'USD', reason: '', description: 'Pago a proveedor' }) }] } }] } };
        if (url.includes(':append')) throw new Error('Sheets unavailable');
        throw new Error(`Unexpected POST ${url}`);
    });

    await sendUpdate({ text: '/solicitar_reembolso' });
    await sendUpdate({ photo: [{ file_id: 'receipt' }] });
    await waitUntil(() => chatStates[chatId]?.state === 'WAITING_REIMBURSEMENT_DATE');
    await sendUpdate({ text: '10/08/2026' });
    expect(chatStates[chatId].state).toBe('WAITING_REIMBURSEMENT_REASON');
    expect(sendTelegramKeyboard).toHaveBeenCalledWith(chatId, expect.stringContaining('motivo'), [['Transporte', 'Suministros']], 'telegram-token');
    await sendUpdate({ text: 'Suministros' });

    expect(chatStates[chatId]).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('No pude confirmar'), 'telegram-token');
    expect(removeTelegramKeyboard).not.toHaveBeenCalled();
});
