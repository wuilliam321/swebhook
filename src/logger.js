const fs = require('fs');
const util = require('util');
const path = require('path');

const logFilePath = path.join(__dirname, '../webhook.log');
const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

function sanitize(value) {
    if (value instanceof Error) return { name: value.name, code: value.code, status: value.response?.status };
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !/token|secret|authorization|password|photo|image|caption|receipt|url/i.test(key))
        .map(([key, item]) => [key, sanitize(item)]));
    if (typeof value !== 'string') return value;
    let text = value.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}/g, '[TOKEN]')
        .replace(/https?:\/\/[^\s"']+/g, '[URL]');
    for (const [key, secret] of Object.entries(process.env)) {
        if (/TOKEN|SECRET|API_KEY|PRIVATE_KEY|PASSWORD/.test(key) && secret?.length > 5) text = text.split(secret).join('[SECRET]');
    }
    return text;
}

const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
};

const logToFile = (level, ...args) => {
    const formattedMessage = util.format(...args);
    logFile.write(`${new Date().toISOString()} [${level.toUpperCase()}] ${formattedMessage}\n`);
};

// Override console methods to log to file as well
// Note: This side-effect is preserved from the original code, 
// but in a cleaner way we might want to export a logger object instead of patching console.
// For now, we'll keep the behavior but export the setup function.

function setupLogging() {
    console.log = (...args) => {
        args = args.map(sanitize);
        logToFile('log', ...args);
        originalConsole.log.apply(console, args);
    };

    console.error = (...args) => {
        args = args.map(sanitize);
        logToFile('error', ...args);
        originalConsole.error.apply(console, args);
    };

    console.warn = (...args) => {
        args = args.map(sanitize);
        logToFile('warn', ...args);
        originalConsole.warn.apply(console, args);
    };
}

module.exports = {
    sanitize,
    setupLogging,
    logToFile
};
