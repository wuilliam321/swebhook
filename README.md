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

### Telegram cURL Examples

Here are some `curl` examples to simulate Telegram messages to your webhook endpoint. Replace `http://localhost:8000` with your actual server address (e.g., your ngrok URL).

#### `/gasto` (Record an expense)

This is a two-step command.

1.  **Initiate the command:**
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": 12345, "type": "private" },
            "text": "/gasto"
        }
    }
    ```

2.  **Provide expense details:**
    The bot will ask `💰 ¿Cuánto gastaste y en qué?`. You reply with the details.
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "from": { "id": 98765 },
            "chat": { "id": 12345, "type": "private" },
            "text": "100 for lunch"
        }
    }
    ```

#### `/report` (Generate a report)

This is a two-step command.

1.  **Initiate the command:**
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": 12345, "type": "private" },
            "text": "/report"
        }
    }
    ```

2.  **Select a period:**
    The bot will show a list of periods. You reply with a number from 0 to 6.
    ```sh
    # Example: Selecting "Mes actual" (Current Month)
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": 12345, "type": "private" },
            "text": "3"
        }
    }
    ```

#### `/consulta_codigo` (Look up product)

This is a two-step command.

1.  **Initiate the command (private chat):**
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": 12345, "type": "private" },
            "text": "/consulta_codigo"
        }
    }
    ```

2.  **Provide the product code:**
    The bot will ask for the code. You reply with it.
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": 12345, "type": "private" },
            "text": "ABC123"
        }
    }
    ```

#### `/consulta_codigo` (in a Group Chat)

In group chats, you should specify the bot's name.

1.  **Initiate the command:**
    ```sh
    # Note the @botname and the negative chat id for groups
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": -12345, "type": "group" },
            "text": "/consulta_codigo@septimodiaboutique_bot"
        }
    }
    ```

2.  **Provide the product code:**
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": -12345, "type": "group" },
            "text": "XYZ789"
        }
    }
    ```

#### `/pagomovil` (Check transactions)

This is a single-step command.

-   **Check Wuilliam's account:**
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": 12345, "type": "private" },
            "text": "/pagomovil_wuilliam"
        }
    }
    ```

-   **Check Gilza's account:**
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "chat": { "id": 12345, "type": "private" },
            "text": "/pagomovil_gilza"
        }
    }
    ```

## Set My Commands

```sh
curl --location 'https://api.telegram.org/bot<TOKEN>/setMyCommands' \
--header 'Content-Type: application/json' \
--data 
{
    "commands": [
        {
            "command": "pagomovil_wuilliam_bot",
            "description": "Wuilliam PagoMovil"
        },
        {
            "command": "pagomovil_gilza_bot",
            "description": "Gilza PagoMovil"
        },
        {
            "command": "consulta_codigo_bot",
            "description": "Consultar codigo"
        }
    ],
    "scope": {
        "type": "all_group_chats"
    }
}
```