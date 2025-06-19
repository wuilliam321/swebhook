# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup and Running
```bash
# Install dependencies
npm install

# Start the webhook server
npm start
# OR directly with environment variables
node --env-file=.env webhook.js
```

### Testing
```bash
# Run all tests
npm test

# Run a specific test file
npx jest webhook.test.js

# Run tests matching a specific pattern
npx jest -t "processCommandQueue"
```

### Environment Configuration
The application requires a `.env` file with the following variables:
```
WEBHOOK_VERIFY_TOKEN=
GRAPH_API_TOKEN=
PHONE_ID=
PORT=8000
DEBUG=false
GENERATOR_URL=http://192.168.1.26:8001
TELEGRAM_TOKEN=
```

### External Tools
When developing, you may need to run an ngrok tunnel:
```bash
ngrok http --url=beetle-prompt-enormously.ngrok-free.app 8000
```

## Code Architecture

### Overview
This is a webhook server that handles messages from both WhatsApp (via Facebook Graph API) and Telegram. It provides a financial assistant bot that can track expenses, check transactions, and generate reports.

### Core Components

1. **Express Server** (`webhook.js`)
   - Handles incoming webhook requests from WhatsApp and Telegram
   - Routes messages to appropriate handlers based on platform and command

2. **Command System**
   - Processes commands like `/gasto`, `/pagomovil_*`, and `/report`
   - Uses state management (via `chatStates` object) for multi-step commands

3. **Asynchronous Job Queue**
   - The `commandQueue` array stores jobs to be processed
   - `processCommandQueue()` ensures jobs are executed sequentially
   - Prevents race conditions when handling multiple requests

4. **External Process Execution**
   - `runCommandAsync()` safely executes external Python scripts
   - Scripts are executed with appropriate arguments based on user commands
   - Results are sent back to users via WhatsApp or Telegram

5. **Message Platforms**
   - **WhatsApp**: Uses Facebook Graph API to send/receive messages
   - **Telegram**: Direct integration for command-based interactions

### Data Flow

1. User sends a command via WhatsApp or Telegram
2. Server receives webhook request
3. Command is parsed and may:
   - Set user chat state for multi-step commands
   - Enqueue a job for asynchronous processing
   - Send immediate response
4. For queued jobs:
   - External Python scripts are executed
   - Results are formatted and sent back to user

### External Dependencies

The webhook integrates with several external services:
- Python scripts for financial operations
- BBVA Provincial bank API (via those scripts)
- Facebook's Graph API for WhatsApp
- Telegram Bot API

### Testing

The codebase uses Jest for testing key components:
- Command execution functions
- Queue processing logic
- Telegram command handling