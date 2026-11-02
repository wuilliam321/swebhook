const axios = require('axios');
const { sendTelegramKeyboard, removeTelegramKeyboard } = require('../../src/api/telegram');
const { conversationContext, sessionFor, sessions, newOperation } = require('../../src/conversations');

jest.mock('axios', () => ({
  default: {
    post: jest.fn()
  }
}));

// Mock config
jest.mock('../../src/config', () => ({
  TELEGRAM_TOKEN: 'mock_token',
  MOCK_TELEGRAM: false
}));

// Mock utils
jest.mock('../../src/utils', () => ({
  escapeMarkdownV2: (text) => text
}));

describe('Telegram Keyboards', () => {
    const chatId = '12345';
    const message = 'Test message';
    const keyboard = [['Btn1', 'Btn2']];

    beforeEach(() => {
        jest.clearAllMocks();
        sessions.clear();
    });

    test('sendTelegramKeyboard should send correct payload', async () => {
        axios.default.post.mockResolvedValue({ data: { result: { message_id: 1 } } });
        
        await sendTelegramKeyboard(chatId, message, keyboard);
        
        expect(axios.default.post).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                chat_id: chatId,
                text: message,
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }),
            { timeout: 15000 }
        );
    });

    test('removeTelegramKeyboard should send remove_keyboard payload', async () => {
        axios.default.post.mockResolvedValue({ data: { result: { message_id: 1 } } });
        
        await removeTelegramKeyboard(chatId, message);
        
        expect(axios.default.post).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                chat_id: chatId,
                text: message,
                reply_markup: {
                    remove_keyboard: true
                }
            }),
            { timeout: 15000 }
        );
    });

    test('removeTelegramKeyboard removes legacy keyboards inside an active flow', async () => {
        axios.default.post.mockResolvedValue({ data: { result: { message_id: 1 } } });
        const session = sessionFor('mock', chatId, 1);
        newOperation(session);
        session.state = { state: 'WAITING_FOR_EMPLOYEE_NAME' };
        await conversationContext.run({ session, operationId: session.operationId }, () =>
            removeTelegramKeyboard(chatId, message));
        expect(axios.default.post).toHaveBeenCalledWith(expect.stringContaining('/sendMessage'),
            expect.objectContaining({ reply_markup: { remove_keyboard: true } }), { timeout: 15000 });
    });

    test('a Telegram 429 retries the same question once after retry_after', async () => {
        jest.useFakeTimers();
        try {
            axios.default.post.mockRejectedValueOnce({
                response: { status: 429, data: { parameters: { retry_after: 3 } } }
            }).mockResolvedValueOnce({ data: { result: { message_id: 7 } } });
            const result = sendTelegramKeyboard(chatId, message, keyboard);
            await jest.advanceTimersByTimeAsync(2999);
            expect(axios.default.post).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);
            expect(await result).toEqual({ success: true, messageId: 7 });
            expect(axios.default.post).toHaveBeenCalledTimes(2);
            expect(axios.default.post.mock.calls[1]).toEqual(axios.default.post.mock.calls[0]);
        } finally {
            jest.useRealTimers();
        }
    });
});
