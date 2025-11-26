const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if not already loaded
if (!process.env.PORT) {
    try {
        const envPath = path.resolve(__dirname, '../.env');
        if (fs.existsSync(envPath)) {
            const envConfig = fs.readFileSync(envPath, 'utf8');
            envConfig.split('\n').forEach(line => {
                const [key, value] = line.split('=');
                if (key && value) {
                    process.env[key.trim()] = value.trim();
                }
            });
        }
    } catch (e) {
        console.warn('Failed to load .env file manually:', e);
    }
}

const {
    WEBHOOK_VERIFY_TOKEN,
    GRAPH_API_TOKEN,
    PHONE_ID,
    PORT = 8000,
    GENERATOR_URL,
    TELEGRAM_TOKEN,
    PAGOMOVIL_API_URL,
    INVENTORY_API_URL,
    MOCK_TELEGRAM = 'false',
    MOCK_SPENDING = 'false',
    MOCK_PAGOMOVIL = 'false',
    MOCK_INVENTORY = 'false'
} = process.env;

// Bot token management - dynamically load from environment variables
const BOT_TOKENS = {};

// Load all bot tokens from environment variables using a naming pattern
Object.keys(process.env).forEach(key => {
    if (key.startsWith('TELEGRAM_TOKEN_')) {
        const botName = key.replace('TELEGRAM_TOKEN_', '').toLowerCase();
        BOT_TOKENS[botName] = process.env[key];
    }
});

// Add default token
BOT_TOKENS.default = TELEGRAM_TOKEN;

// Validate required tokens at startup
const requiredBots = ['septimodiaboutique_bot'];
requiredBots.forEach(botName => {
    const token = BOT_TOKENS[botName.toLowerCase()];
    if (!token) {
        console.warn(`Warning: Missing token for bot '${botName}'. Environment variable TELEGRAM_TOKEN_${botName.toUpperCase()} is not set.`);
    }
});

module.exports = {
    WEBHOOK_VERIFY_TOKEN,
    GRAPH_API_TOKEN,
    PHONE_ID,
    PORT,
    GENERATOR_URL,
    TELEGRAM_TOKEN,
    PAGOMOVIL_API_URL,
    INVENTORY_API_URL,
    BOT_TOKENS,
    MOCK_TELEGRAM: MOCK_TELEGRAM === 'true',
    MOCK_SPENDING: MOCK_SPENDING === 'true',
    MOCK_PAGOMOVIL: MOCK_PAGOMOVIL === 'true',
    MOCK_INVENTORY: MOCK_INVENTORY === 'true',
    getTokenForBot: (botName) => {
        if (!botName) return BOT_TOKENS.default;
        return BOT_TOKENS[botName.toLowerCase()] || BOT_TOKENS.default;
    },
    isValidBotName: (botName) => {
        return botName && (BOT_TOKENS[botName.toLowerCase()] !== undefined);
    }
};
