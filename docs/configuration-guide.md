# TwinClaw Configuration Guide

TwinClaw manages state and secrets securely using a combination of a central canonical JSON file and an AES-256 encrypted SQLite vault. This guide outlines configuration mechanics, schema paths, precedence rules, and safe profile management.

## 1. Single Source of Truth (`twinclaw.json`)

By default, TwinClaw requires a single JSON configuration file placed inside the runtime home directory:
`~/.twinclaw/twinclaw.json` (or `%USERPROFILE%\.twinclaw\twinclaw.json` on Windows).

This JSON file enforces schema types and groups related capabilities natively to avoid `.env` drift and partial configurations.

### 1.1 Custom Path Mapping
If you are running multiple TwinClaw agents on a single host or prefer to store configuration elsewhere, you can override the resolution path using the `TWINCLAW_CONFIG_PATH` environment variable:
```bash
export TWINCLAW_CONFIG_PATH="/etc/twinclaw/production.json"
twinclaw start
```

## 2. Deprecation of `.env`

TwinClaw used to rely on `.env` bindings. While legacy `.env` entries will still map to `twinclaw.json` structures, TwinClaw explicitly warns against this usage. All operators are strongly advised to run the onboarding wizard to migrate:
```bash
twinclaw onboard
```
This utility captures your existing environment configuration and persists it securely to `twinclaw.json` and the encrypted secret vault.

## 3. Configuration Access & Runtime Precedence

To enforce security boundaries, configuration data is prioritized in this order:
1. **Locally Encrypted Secret Vault (`~/.twinclaw/secrets.sqlite`)**: Sensitive keys securely managed by TwinClaw at runtime.
2. **Canonical JSON File (`twinclaw.json`)**: All non-secret configuration (settings, channels, paths).
3. **Legacy Environment Hooks (`process.env`)**: Fallback for backward compatibility (yields warnings).

**NOTE:** Credentials configured directly in `twinclaw.json` that require vault migration will generate diagnostics and CLI prompts advising manual ingestion using `twinclaw secret set <KEY>`.

## 4. Diagnostics & Troubleshooting

Malformed or incomplete configurations present actionable validation diagnostics during startup (e.g., when running `twinclaw start`). 

You can manually trigger these validations through the built-in doctor:
```bash
twinclaw doctor
```

Error scenarios handled automatically include:
- **`ENOENT` Fallback**: If `twinclaw.json` is missing, TwinClaw falls back to an interactive setup workflow or creates `twinclaw.json` with safe defaults.
- **Malformed Syntax**: If the file contains syntax errors, TwinClaw fails fast and prints exact line offsets without exposing secrets.
- **Value Errors**: Values mapped differently than the schema permits throw precise type hints.

## 5. Security Note
Never manually insert secret keys directly into `twinclaw.json` without first securing directory and file permissions (`0600`). Even then, managing credentials via the Secret Vault command-line integration is the only approved methodology.
