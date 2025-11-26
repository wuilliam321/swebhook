const fs = require('fs');
const util = require('util');
const path = require('path');

const logFilePath = path.join(__dirname, '../webhook.log');
const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

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
        logToFile('log', ...args);
        originalConsole.log.apply(console, args);
    };

    console.error = (...args) => {
        logToFile('error', ...args);
        originalConsole.error.apply(console, args);
    };

    console.warn = (...args) => {
        logToFile('warn', ...args);
        originalConsole.warn.apply(console, args);
    };
}

module.exports = {
    setupLogging,
    logToFile
};
