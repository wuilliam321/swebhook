# swebhook
Financial assistant webhook server for WhatsApp and Telegram

## Running the Server
```bash
# Start ngrok tunnel
ngrok http --url=beetle-prompt-enormously.ngrok-free.app 8000

# Start the webhook server
node --env-file=.env index.js
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
TELEGRAM_TOKEN_SEPTIMODIABOUTIQUE_BOT=
PAGOMOVIL_API_URL=http://localhost:5000
INVENTORY_API_URL=http://localhost:5001
OPENAI_API_KEY=
OPENAI_EXPENSE_MODEL=gpt-4.1-mini
GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
SSH_HOST=
SSH_USER=
SSH_DEST_PATH=
IMAGE_BASE_URL=
SSH_KEY_PATH=./7dbimages.pem
SSH_PASSPHRASE=
EXPENSE_TIMEZONE=America/Caracas
FIREBASE_SERVICE_ACCOUNT_PATH=
MOCK_TELEGRAM=false
```

`TELEGRAM_TOKEN` is the default bot token. Additional bots use `TELEGRAM_TOKEN_<BOT_NAME>`; the code expects `TELEGRAM_TOKEN_SEPTIMODIABOUTIQUE_BOT` for the boutique bot. `OPENAI_EXPENSE_MODEL` and `EXPENSE_TIMEZONE` have defaults in `src/config.js`. `HISTORY_SPREADSHEET_ID` and `RODEO_SPREADSHEET_ID` are optional; omit them to use the defaults in `src/config.js` (do not leave them empty). Firebase accepts `FIREBASE_SERVICE_ACCOUNT` (service account JSON) instead of `FIREBASE_SERVICE_ACCOUNT_PATH`; without either, it looks for `service-account-firebase.json` in the repository root. Keep tokens and service account files out of version control.

## Telegram integrations

The `/telegram` webhook receives updates. Replies and photos use the Telegram Bot API (`api.telegram.org`). Commands also depend on these systems:

| System | Repository / configuration | Telegram commands and API calls |
| --- | --- | --- |
| Financial backend | [`../7db-family-financial`](../7db-family-financial), `PAGOMOVIL_API_URL` | `/pagomovil_*` calls `POST /pagomovil`; `/cierre_*` calls `POST /cierre`; `/cashea_abonos` calls `POST /bnc`; `/gasto` calls `POST /spending`; `/marcar` calls `POST /asistencia`. |
| Inventory backend | [`../7db-inventariodb`](../7db-inventariodb), `INVENTORY_API_URL` | `/consulta_codigo` calls `POST /consulta_producto`; `/deposito` calls `POST /deposito`; `/report` calls `POST /reporte_ventas`; `/outfit` calls `POST /outfit`. |
| OpenAI Responses API | `OPENAI_API_KEY`, optional `OPENAI_EXPENSE_MODEL` | `/gasto_history` and `/gasto_rodeo` extract structured expenses through `POST https://api.openai.com/v1/responses`. |
| Google Sheets API | `GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE`, optional `HISTORY_SPREADSHEET_ID` and `RODEO_SPREADSHEET_ID` | `/gasto_history` and `/gasto_rodeo` write to the `Registro de gastos` sheet after authenticating with a Google service account. |
| Firebase Realtime Database | `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_SERVICE_ACCOUNT_PATH` | `/marcar` reads employees from `7db-adm/users` and reminders from `7db-adm/reminders`. |
| Gemini, Google Sheets and image storage | `GEMINI_API_KEY`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE`, `SSH_*`, `IMAGE_BASE_URL` | `/solicitar_reembolso` extracts payment details from a Telegram photo, uploads the receipt and writes a reimbursement row. |

In Docker Compose, this webhook uses the external `7db-family` network and connects to `pagomovil-api:5000` and `inventariodb-api:5001`; start the services from their sibling repositories separately. The Compose file mounts `service-account-firebase.json` and `service-account-credentials.json` from this repository. Set `GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE` to the path of the latter inside the container if using it for structured expenses. Local URLs in the example above apply only when those APIs run on the host.

`/solicitar_reembolso` uses spreadsheet `1xIlDWHmxH4T53UTbYcAs-I1pdTeKY7nDQNyE8bOKKnk` by default; override with `REIMBURSEMENTS_SPREADSHEET_ID`. Share it with the Google service account. The command reads allowed motives from `Cuentas!E:E` and accounts from `Cuentas!K:K`, defaulting to `BS Pago Movil`. It appends date (`DD/MM/YYYY`), USD amount, VES amount, motive, account, description and receipt URL to `Reembolsos!A:H` (column B remains blank). It creates the `Comprobante` header in H1 if empty. The service account also needs edit access to the sheet.

Receipt uploads follow the storage layout of [`../7db-images-admin`](../7db-images-admin): files go to `${SSH_DEST_PATH}/reembolsos/` and their public URLs use `${IMAGE_BASE_URL}/reembolsos/`. Set `SSH_HOST`, `SSH_USER`, `SSH_DEST_PATH`, `IMAGE_BASE_URL` and either `SSH_KEY_PATH` or `SSH_PRIVATE_KEY`. Set `SSH_PASSPHRASE` when the key is encrypted. Docker Compose mounts `../7db-images-admin/7dbimages.pem` at `/app/7dbimages.pem`; set `SSH_KEY_PATH=/app/7dbimages.pem` there. Anyone with a receipt URL can view its image.

WhatsApp uses Meta Graph API with `GRAPH_API_TOKEN`, `PHONE_ID` and `WEBHOOK_VERIFY_TOKEN`. Its `/webhook` handler also calls `POST /generate` at `GENERATOR_URL`; a matching service exists in [`../signed-url-generator`](../signed-url-generator). The separate `/chat` handler invokes a Python script at a hard-coded path outside this repository.

## Project Structure
- `index.js`: Entry point of the application.
- `src/app.js`: Express application setup and route handlers.
- `src/config.js`: Configuration and environment variable management.
- `src/logger.js`: Logging setup.
- `src/utils.js`: Utility functions.
- `src/state.js`: Chat state management.
- `src/queue.js`: Command queue processing logic.
- `src/api/`: API clients for external services (Telegram, Spending, Inventory, PagoMóvil).
- `src/outfit.js`: Outfit generation logic.

## Supported Commands

### Telegram Commands

- `/gasto` - Record an expense
  - Usage: Type `/gasto` then follow the prompts
  - Supports:
    - **Text**: e.g., "100 for lunch".
    - **Voice Notes**: Description inferred from audio.
    - **Photos**:
      - With caption: Processed immediately.
      - Without caption: Bot will ask you to send the text (amount/description).

- `/report` - Generate financial reports
  - Usage: Type `/report` then select a time period (0-6)
  - Periods: Today, Current Week, Last Week, Current Month, Last Month, Current Quarter, Last Quarter

- `/consulta_codigo` - Look up product information
  - Usage: Type `/consulta_codigo` then enter a product code
  - Example: When prompted, enter "ABC123"

- `/pagomovil_wuilliam` - Check Wuilliam's PagoMóvil transactions

- `/pagomovil_gilza` - Check Gilza's PagoMóvil transactions

- `/solicitar_reembolso` - Request a reimbursement: attach a payment receipt photo, then supply any missing date, amount or motive. The bot confirms after saving the sheet row.

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

3.  **Provide expense details (Voice/Media):**
    Alternatively, you can send a voice note or photo.
    ```sh
    curl --location 'http://localhost:8000/telegram' \
    --header 'Content-Type: application/json' \
    --data 
    {
        "message": {
            "from": { "id": 98765 },
            "chat": { "id": 12345, "type": "private" },
            "voice": { "file_id": "AgACAgEAAxkBAA..." }
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
        },
        {
            "command": "solicitar_reembolso",
            "description": "Solicitar reembolso con comprobante"
        }
    ],
    "scope": {
        "type": "all_group_chats"
    }
}
```
