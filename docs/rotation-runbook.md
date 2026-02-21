# Credential Rotation Runbook

This runbook provides non-interactive, printable steps for rotating TwinClaw credentials without exposing secret values.

## Scope

Supported providers and channels covered by this runbook:

- Runtime secret: `API_SECRET`
- Model providers: `OPENROUTER_API_KEY`, `MODAL_API_KEY`, `GEMINI_API_KEY`
- Voice provider: `GROQ_API_KEY`
- Messaging: `TELEGRAM_BOT_TOKEN`, `WHATSAPP_PHONE_NUMBER`

---

## 1) Preparation Checklist

1. Pause release activity for the environment being rotated.
2. Generate replacement credentials in each provider console.
3. Store new values in a secure operator channel (never in repo files).
4. Verify TwinClaw CLI access in the target workspace.

---

## 2) Rotation Commands (Non-Interactive)

Use secret-vault commands so values are never persisted in markdown/docs:

```powershell
node src/index.ts secret set API_SECRET "<NEW_API_SECRET>"
node src/index.ts secret set OPENROUTER_API_KEY "<NEW_OPENROUTER_API_KEY>"
node src/index.ts secret set MODAL_API_KEY "<NEW_MODAL_API_KEY>"
node src/index.ts secret set GEMINI_API_KEY "<NEW_GEMINI_API_KEY>"
node src/index.ts secret set GROQ_API_KEY "<NEW_GROQ_API_KEY>"
node src/index.ts secret set TELEGRAM_BOT_TOKEN "<NEW_TELEGRAM_BOT_TOKEN>"
node src/index.ts secret set WHATSAPP_PHONE_NUMBER "<NEW_WHATSAPP_PHONE_NUMBER>"
```

If rotating an existing secret with audit context:

```powershell
node src/index.ts secret rotate OPENROUTER_API_KEY "<NEW_OPENROUTER_API_KEY>" --reason "scheduled quarterly rotation"
```

---

## 3) Channel-Specific Steps

### Telegram

1. Use `@BotFather` to regenerate/revoke token.
2. Rotate `TELEGRAM_BOT_TOKEN` via `secret set` or `secret rotate`.
3. Confirm pairing/allowlist behavior still works.

### WhatsApp

1. Rotate `WHATSAPP_PHONE_NUMBER` if phone identity changed.
2. Re-login session if required:

```powershell
node src/index.ts channels login whatsapp
```

### OpenRouter / Modal / Gemini / Groq

1. Create replacement API key in provider dashboard.
2. Rotate key in TwinClaw secret vault via command above.
3. Revoke old key in provider dashboard immediately after successful validation.

---

## 4) Validation

Run after every rotation batch:

```powershell
node src/index.ts secret doctor
node src/index.ts config doctor
npm run mvp:gate:local
```

Expected outcomes:

- `secret doctor` reports healthy status.
- `config doctor` has no fatal issues.
- MVP gate does not fail `vault-health` or `config-schema` checks.

---

## 5) Emergency Compromise Procedure

1. Revoke compromised credential in provider console immediately.
2. Rotate corresponding TwinClaw secret via `secret set`/`secret rotate`.
3. Re-run validation commands.
4. Record incident details and affected key names in internal incident notes.
5. If vault health is degraded, block release until `vault-health` check is green.
