const { extractBotName, extractBaseCommand } = require('../../src/utils');

describe('Unit Tests: Utils', () => {
    test('extractBotName should return bot name from command', () => {
        expect(extractBotName('/start@mybot')).toBe('mybot');
        expect(extractBotName('/start@MyBot')).toBe('mybot');
        expect(extractBotName('/start')).toBeNull();
    });

    test('extractBaseCommand should return command without bot name', () => {
        expect(extractBaseCommand('/start@mybot')).toBe('/start');
        expect(extractBaseCommand('/start')).toBe('/start');
        expect(extractBaseCommand('/start_bot')).toBe('/start');
    });
});
