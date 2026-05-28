const axios = require('axios');
const { sendTelegramKeyboard, removeTelegramKeyboard } = require('../../src/api/telegram');

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
    });

    test('sendTelegramKeyboard should send correct payload', async () => {
        axios.default.post.mockResolvedValue({ status: 200 });
        
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
            })
        );
    });

    test('removeTelegramKeyboard should send remove_keyboard payload', async () => {
        axios.default.post.mockResolvedValue({ status: 200 });
        
        await removeTelegramKeyboard(chatId, message);
        
        expect(axios.default.post).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                chat_id: chatId,
                text: message,
                reply_markup: {
                    remove_keyboard: true
                }
            })
        );
    });
});
