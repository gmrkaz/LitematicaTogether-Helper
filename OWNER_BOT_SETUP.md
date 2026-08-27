# Separate Telegram Owner Bot on Bot-Hosting.net

Run this as a SECOND Bot-Hosting Application deployment from the same GitHub repository.

## Entry file

`owner-telegram-bot.js`

## Environment variables on the Telegram bot deployment

- `TELEGRAM_BOT_TOKEN` — token of the separate Telegram bot from BotFather.
- `TELEGRAM_CHAT_ID` — Telegram chat/user ID that receives owner-call notifications.
- `OWNER_BOT_SHARED_SECRET` — random secret, at least 24 characters.
- `PORT` — use the port assigned/configured by Bot-Hosting.

Expose the deployment port/domain and use its `/notify` endpoint from the Discord Helper.

## Environment variables on the Discord Helper deployment

- `OWNER_BOT_WEBHOOK_URL` — public URL of the separate Telegram deployment ending in `/notify`.
- `OWNER_BOT_SHARED_SECRET` — exactly the same secret as on the Telegram deployment.

The Discord Helper does NOT need `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` anymore.

## Health check

`GET /healthz`

Expected response:

```json
{"ok":true,"service":"ltt-owner-telegram-bot"}
```

## Security

Do not commit bot tokens or the shared secret to GitHub. Store them only in Bot-Hosting environment variables.
