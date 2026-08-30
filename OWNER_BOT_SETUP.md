# Separate Telegram Owner Bot on Bot-Hosting.net

Run this as a SECOND Bot-Hosting Application deployment from the same GitHub repository.

## Entry file

`owner-telegram-bot.js`

## Environment variables on the Telegram bot deployment

Required:

- `TELEGRAM_BOT_TOKEN` — token of the separate Telegram bot from BotFather.
- `TELEGRAM_CHAT_ID` — ONLY this Telegram chat/user ID may use owner-management commands.
- `OWNER_BOT_SHARED_SECRET` — random secret, at least 24 characters.
- `PORT` — use the port assigned/configured by Bot-Hosting.

For Discord management from Telegram:

- `DISCORD_BOT_TOKEN` — the Discord HELPER bot token. Keep it only in environment variables.
- `GUILD_ID` — the Litematica Together Discord server ID.
- `OWNER_BOT_ENABLE_POLLING=true` — enables Telegram command polling. This is enabled by default.

Expose the deployment port/domain and use its `/notify` endpoint from the Discord Helper.

## Environment variables on the Discord Helper deployment

- `OWNER_BOT_WEBHOOK_URL` — public URL of the separate Telegram deployment ending in `/notify`.
- `OWNER_BOT_SHARED_SECRET` — exactly the same secret as on the Telegram deployment.

The Discord Helper does NOT need `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID`.

## Telegram owner commands

- `/start` or `/menu` — owner control panel.
- `/status` — Discord server status and latest Modrinth version.
- `/channels` — list Discord categories/channels and their IDs.
- `/modrinth` — latest Litematica Together release.
- `/announce_ru текст` — publish to `#объявления`.
- `/announce_en text` — publish to `#announcements`.
- `/announce_both текст` — publish the same text to both announcement channels.
- `/say канал | текст` — publish to any Discord text channel by channel name or ID.
- `/topic канал | topic` — update a Discord channel topic.
- `/hidden USER_ID on|off` — add/remove the `Hidden` role.
- `/role USER_ID | ROLE | on|off` — add/remove any role by role name or ID.

Examples:

```text
/announce_ru Сегодня вышла новая тестовая сборка.
/say обновления | Проверяем новую версию синхронизации.
/topic дорожная-карта | Актуальные планы разработки Litematica Together.
/hidden 123456789012345678 on
/role 123456789012345678 | Moderator | on
```

## Health check

`GET /healthz`

The response includes whether Discord management and Telegram polling are enabled.

## Security

Do not commit Telegram tokens, Discord tokens, chat IDs intended to stay private, or the shared secret to GitHub. Store them only in Bot-Hosting environment variables.

Only the exact `TELEGRAM_CHAT_ID` is allowed to execute management commands. Messages from other Telegram chats are ignored.
