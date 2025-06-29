# swebhook
Financial assistant webhook server for WhatsApp and Telegram

## Running the Server
```bash
# Start ngrok tunnel
ngrok http --url=beetle-prompt-enormously.ngrok-free.app 8000

# Start the webhook server
node --env-file=.env webhook.js
```

## Environment Configuration
Create an `.env` file with the following variables:
```
WEBHOOK_VERIFY_TOKEN=
GRAPH_API_TOKEN=
PHONE_ID=
PORT=8000
DEBUG=false
GENERATOR_URL=http://192.168.1.26:8001
TELEGRAM_TOKEN=
```

## Supported Commands

### Telegram Commands

- `/gasto` - Record an expense
  - Usage: Type `/gasto` then follow the prompts
  - Example: When prompted, enter "100 for lunch"

- `/report` - Generate financial reports
  - Usage: Type `/report` then select a time period (0-6)
  - Periods: Today, Current Week, Last Week, Current Month, Last Month, Current Quarter, Last Quarter

- `/consulta_codigo` - Look up product information
  - Usage: Type `/consulta_codigo` then enter a product code
  - Example: When prompted, enter "ABC123"

- `/pagomovil_wuilliam` - Check Wuilliam's PagoMóvil transactions

- `/pagomovil_gilza` - Check Gilza's PagoMóvil transactions
