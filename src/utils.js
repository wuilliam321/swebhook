const { exec } = require('child_process');

// Extract bot name from commands with format /command@botname
function extractBotName(command) {
    if (!command) return null;
    const atIndex = command.indexOf('@');
    if (atIndex !== -1) {
        return command.substring(atIndex + 1).toLowerCase();
    }
    return null;
}

// Extract base command from /command@botname or /command_bot format
function extractBaseCommand(command) {
    if (!command) return command;

    // Check for @botname format
    const atIndex = command.indexOf('@');
    if (atIndex !== -1) {
        command = command.substring(0, atIndex);
    }

    // Check for _bot suffix
    const botSuffix = "_bot";
    if (command.endsWith(botSuffix)) {
        return command.substring(0, command.length - botSuffix.length);
    }

    return command;
}

// Escape special characters for MarkdownV2
function escapeMarkdownV2(text) {
    return text
        .replace(/[_*[\]()~`>#+\-=|{}.!]/g, ch => '\\' + ch);
}

function runCommand(_, appPath, args) {
    // Simple quoting for arguments. This might need to be more robust
    // depending on the shell and potential argument content.
    const escapedArgs = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = `${appPath} ${escapedArgs}`;
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
            // Consider how to send error back via res if needed
            return;
        }
        if (stderr) {
            console.error(`stderr: ${stderr}`);
            // Consider how to send error back via res if needed
            return;
        }
        console.log(`stdout: ${stdout}`);
        // Consider how to send stdout back via res if needed
    });
}

async function runCommandAsync(appPath, args) {
    return new Promise((resolve, reject) => {
        // Simple quoting for arguments. This might need to be more robust
        // depending on the shell and potential argument content.
        const escapedArgs = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
        const cmd = `${appPath} ${escapedArgs || "''"}`; // Ensure at least empty quotes if no args
        console.log('Executing command:', cmd);

        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                // Execution error (e.g., command not found, non-zero exit code)
                console.error(`Error executing command: ${error.message}`);
                console.error(`stderr: ${stderr}`); // Log stderr here as it often contains useful info on error
                reject({ type: 'error', error: error, stderr: stderr });
            } else if (stderr) {
                // Command executed successfully but produced output on stderr
                // This might be treated as an error or warning depending on the use case.
                // For this refactoring, we'll treat it as a reason to reject,
                // allowing the caller to decide if stderr output is acceptable.
                console.warn(`Command produced stderr: ${stderr}`);
                reject({ type: 'error', error: null, stderr: stderr });
            } else {
                // Success
                console.log(`stdout: ${stdout}`);
                resolve({ type: 'success', stdout: stdout });
            }
        });
    });
}

module.exports = {
    extractBotName,
    extractBaseCommand,
    escapeMarkdownV2,
    runCommand,
    runCommandAsync
};
