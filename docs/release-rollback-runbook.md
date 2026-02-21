# Release & Rollback Runbook

## Purpose
Use this runbook to execute deterministic release preflight checks, prepare a release candidate with snapshot metadata, and perform rollback when post-release health degrades.

## 1) Preflight Validation
Run preflight before every deployment candidate:

```powershell
npm run release:preflight -- --health-url http://127.0.0.1:3100/health
```

Preflight gates:
- TypeScript build (`npm run build`)
- Test suite (`npm run test`)
- API health probe (`GET /health`)
- Critical interface readiness checks (`gui`, dispatcher interface, MCP config)

If preflight fails, the output identifies the failed subsystem and includes command/health diagnostics.

## 2) Prepare Release Candidate
Generate a release manifest and runtime snapshot:

```powershell
npm run release:prepare -- --health-url http://127.0.0.1:3100/health
```

Artifacts are written under:
- `memory/release-pipeline/manifests/<release_id>.json`
- `memory/release-pipeline/snapshots/<snapshot_id>/metadata.json`

The manifest captures:
- app version + git commit
- preflight results
- artifact pointers
- snapshot linkage for rollback

## 3) Rollback Procedure
Rollback to the latest snapshot:

```powershell
npm run release:rollback -- --health-url http://127.0.0.1:3100/health
```

Rollback to a specific snapshot:

```powershell
npm run release:rollback -- --snapshot <snapshot_id> --health-url http://127.0.0.1:3100/health
```

Optional restart hook:

```powershell
npm run release:rollback -- --snapshot <snapshot_id> --restart-command "npm run start"
```

Rollback guarantees:
- Restores critical runtime assets (DB, identity, config)
- Writes rollback state + append-only audit log (`memory/release-pipeline/rollback-audit.log`)
- Enforces post-restore health verification
- Is idempotent (`noop` if snapshot already restored and healthy)

## 4) Automated Rollback Drill (No Live Impact)
Run the scripted rollback drill:

```powershell
npm run release:drill -- --health-url http://127.0.0.1:3100/health
```

Drill behavior:
- Executes preflight and release preparation to capture a snapshot.
- Simulates rollback execution using snapshot state.
- Performs integrity validation across critical assets.
- Appends drill audit records to `memory/release-pipeline/drill-audit.log`.

Use drill output as release evidence before promoting environment changes.

## 5) Failure Diagnostics & Decisions
Use these signals before/after rollback:
- `GET /health` for system readiness and MCP degradation states
- `GET /reliability` for queue/callback reliability pressure
- Manifest diagnostics in `memory/release-pipeline/manifests/*.json`
- Rollback audit events in `memory/release-pipeline/rollback-audit.log`

DM pairing operations (Telegram/WhatsApp) during release validation:

```powershell
node src/index.ts pairing list telegram
node src/index.ts pairing list whatsapp
node src/index.ts pairing approve <channel> <CODE>
```

Pairing notes:
- Unknown DM senders are blocked from gateway processing until approved.
- Pairing requests expire after one hour and are capped per channel.
- Approved identities are stored under `memory/credentials/*-allowFrom.json`.

Decision guide:
- **Build/tests fail:** stop release, fix code regressions.
- **Health probe fails pre-release:** investigate runtime readiness before deploy.
- **Rollback result = failed:** inspect missing/corrupt snapshot assets, repair snapshot, rerun rollback.
- **Rollback result = noop but health failed:** rerun with explicit snapshot + restart command and escalate incident handling.
