# Repository Guidelines

## Project Structure & Module Organization
- `webhook.js` hosts the Express webhook handlers for Telegram and WhatsApp, queueing logic, and logging to `webhook.log`.
- Tests live in `webhook.test.js` and mirror handler behavior with Jest mocks; keep additional fixtures beside their subjects.
- Runtime configuration comes from `.env`; Docker assets (`Dockerfile`, `docker-compose.yml`) boot the service in `/app` with tokens injected.
- Utility scripts: `run.sh` restarts `npm run start`; logs default to files in the repo root.

## Build, Test, and Development Commands
- Start locally with `npm run start` (loads `.env` via Node's `--env-file` flag); pair with `ngrok http 8000` for external callbacks.
- Run once without the loop using `node --env-file=.env webhook.js`.
- Execute the container stack via `docker compose up --build webhook-telegram`.
- Run the Jest suite with `npm test`; watch mode is available through `npx jest --watch`.

## Coding Style & Naming Conventions
- Use 2-space indentation, CommonJS modules, and `camelCase` helpers; async helpers return Promises.
- Favor template literals for interpolated strings and guard logging through the provided wrappers.
- Environment keys stay `SCREAMING_SNAKE_CASE`; Telegram command handlers use `/command_name` semantics.
- Run `npx eslint webhook.js webhook.test.js` before sending a PR.

## Testing Guidelines
- Place new specs under `*.test.js` alongside their targets and rely on Jest mocks (`axios`, `child_process`, `puppeteer`).
- Cover chat-state transitions and queue side effects; assert both API payloads and queue objects.
- Use representative CLI arguments, e.g. `['--period=0']`, and simulate Telegram chats with minimal JSON mocks.

## Commit & Pull Request Guidelines
- Commit messages are short and present-tense (e.g., `prevent multiple calls to pagomovil at the same time`); avoid generic `fix` once you have context.
- PRs should outline the command(s) used for verification (`npm test`, manual Telegram curl), note affected bots, and link issues or tickets.
- Include screenshots or JSON samples when altering response copy; mention env variable changes explicitly.

## Security & Configuration Tips
- Keep API tokens in `.env` and never commit the file; verify required `TELEGRAM_TOKEN_*` keys before deploying.
- Scrub `webhook.log` before sharing logs; it records full command payloads.
- When exposing the webhook externally, rotate the ngrok URL and update Meta/Telegram callbacks accordingly.
