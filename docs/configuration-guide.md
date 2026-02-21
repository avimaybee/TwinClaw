# TwinClaw Configuration Guide

TwinClaw manages state and secrets securely using a combination of a central canonical JSON file and an AES-256 encrypted SQLite vault. This guide outlines configuration mechanics, schema paths, precedence rules, and safe profile management.

## 1. Workspace Structure

TwinClaw organizes all state, configuration, and identity files into a unified **workspace** directory. By default, this workspace is located at:
- `%USERPROFILE%\.twinclaw\workspace\`

### 1.1 Workspace Contents

The workspace directory contains:
- `twinclaw.json` - Main configuration file
- `memory/` - SQLite databases and vector storage
- `identity/` - Persona files (soul.md, identity.md, user.md)
- `transcripts/` - Daily conversation transcripts
- `secrets.sqlite` - Encrypted secret vault
- `.gitignore` - Auto-generated ignore patterns for safe backup

### 1.2 Profile Isolation

You can run multiple isolated TwinClaw profiles on the same machine by setting the `TWINCLAW_PROFILE` environment variable:

```powershell
$env:TWINCLAW_PROFILE = "production"
twinclaw start
```

This creates a separate workspace at `%USERPROFILE%\.twinclaw\workspace-production\` with completely isolated configuration, memory, and identity.

## 2. Single Source of Truth (`twinclaw.json`)

The canonical configuration file is located at:
`%USERPROFILE%\.twinclaw\workspace\twinclaw.json`

This JSON file enforces schema types and groups related capabilities natively to avoid `.env` drift and partial configurations.

### 2.1 Custom Path Mapping
If you need to override the default workspace location, you can set the `TWINCLAW_CONFIG_PATH` environment variable:
```powershell
$env:TWINCLAW_CONFIG_PATH = "C:\\TwinClaw\\profiles\\production.json"
twinclaw start
```

### 2.2 Migration from Legacy Structure

If you have an existing `%USERPROFILE%\.twinclaw\twinclaw.json` from a previous version, TwinClaw will automatically migrate your configuration to the new workspace structure on first run. The original files are preserved in place.

## 3. Deprecation of `.env`

TwinClaw used to rely on `.env` bindings. While legacy `.env` entries will still map to `twinclaw.json` structures, TwinClaw explicitly warns against this usage. All operators are strongly advised to run the onboarding wizard to migrate:
```powershell
twinclaw onboard
```
This utility captures your existing environment configuration and persists it securely to `twinclaw.json` and the encrypted secret vault.

## 3. First-Run Sequence (Channels & Doctor)

To establish a fully functional TwinClaw agent for the first time, follow this strict bootstrap sequence:

1. **Wizard Configuration**: Run `node src/index.ts setup` (or `twinclaw onboard`) to initialize API keys and runtime parameters.
2. **Channel Login**: Link your primary messaging integration. For WhatsApp, run `node src/index.ts channels login whatsapp` and scan the QR code with your mobile device.
3. **Doctor Validation**: Run `node src/index.ts doctor` to verify that `twinclaw.json` is correctly structured and that the channel auth directories have been populated.
4. **DM Pairing Policy**: Once connected, follow the DM Pairing Policy instructions (sending initial messages) to finalize the secure conversational loop.

## 4. Configuration Access & Runtime Precedence

To enforce security boundaries, configuration data is prioritized in this order:
1. **Locally Encrypted Secret Vault (`%USERPROFILE%\.twinclaw\workspace\secrets.sqlite`)**: Sensitive keys securely managed by TwinClaw at runtime.
2. **Canonical JSON File (`twinclaw.json`)**: All non-secret configuration (settings, channels, paths).
3. **Legacy Environment Hooks (`process.env`)**: Fallback for backward compatibility (yields warnings).

**NOTE:** Credentials configured directly in `twinclaw.json` that require vault migration will generate diagnostics and CLI prompts advising manual ingestion using `twinclaw secret set <KEY>`.

## 5. Diagnostics & Troubleshooting

Malformed or incomplete configurations present actionable validation diagnostics during startup (e.g., when running `twinclaw start`). 

You can manually trigger these validations through the built-in doctor:
```powershell
twinclaw doctor
```

Error scenarios handled automatically include:
- **`ENOENT` Fallback**: If `twinclaw.json` is missing, TwinClaw falls back to an interactive setup workflow or creates `twinclaw.json` with safe defaults.
- **Malformed Syntax**: If the file contains syntax errors, TwinClaw fails fast and prints exact line offsets without exposing secrets.
- **Value Errors**: Values mapped differently than the schema permits throw precise type hints.

**Common Channel Bootstrap Failures:**
- **WhatsApp Authentication Failure**: Run `node src/index.ts channels login whatsapp` again. If it persists or hangs, manually delete the `./memory/whatsapp_auth` directory and retry.
- **Doctor warns about unlinked channels**: Ensure the QR code was successfully scanned before the setup session timed out. Check `twinclaw.json` to confirm the target channel is truly enabled.

## 5.1 Tool Exposure Policy (`tools.allow` / `tools.deny`)

TwinClaw can scope model-visible tools directly from `twinclaw.json`:

- `tools.allow`: Optional allowlist selectors (exact tool names, `group:*`, `source:*`, `mcp:<serverId>`).
- `tools.deny`: Optional denylist selectors applied after `tools.allow`.

Example:

```json
{
  "tools": {
    "allow": ["group:fs"],
    "deny": ["fs.apply_patch"]
  }
}
```

## 6. Security Note
Never manually insert secret keys directly into `twinclaw.json` without first securing directory and file ACLs for the current Windows user account. Even then, managing credentials via the Secret Vault command-line integration is the only approved methodology.

### 6.1 Signed Control-Plane Endpoints

All control-plane HTTP routes except `/health`, `/health/live`, and `/health/ready` now require an `X-Signature` header:

`X-Signature: sha256=<HMAC_SHA256(raw_request_body, API_SECRET)>`

This prevents unauthorized local process access to sensitive routes such as logs, restore, browser controls, and system halt.

### 6.2 Browser Navigation SSRF Guard

Browser snapshot navigation is restricted by `BROWSER_ALLOWED_HOSTS` (comma-separated hostnames, wildcard `*.domain.com` supported). Requests to localhost, loopback, and private-network hosts are blocked.

Example:

```powershell
$env:BROWSER_ALLOWED_HOSTS = "example.com,*.trusted.internal"
```

### 6.3 API Bind Host

Control Plane now binds to loopback by default:

```powershell
$env:API_BIND_HOST = "127.0.0.1"
```

Set this explicitly only when you intentionally need remote network exposure.

### 6.4 WhatsApp Chromium Sandbox

WhatsApp automation now keeps Chromium sandboxing enabled by default. Only disable sandbox in tightly isolated environments:

```powershell
$env:WHATSAPP_DISABLE_CHROMIUM_SANDBOX = "true"
```
