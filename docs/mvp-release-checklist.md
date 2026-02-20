# MVP Release Checklist

Use this document as the operator-facing gate for every TwinClaw release candidate. The checklist maps to the automated `npm run mvp:gate` output and defines the go/no-go decision protocol.

---

## Quick Start

Run the automated gate locally (no running server required):

```bash
npm run mvp:gate:local
```

Run with live API health verification (requires `npm start` to be running):

```bash
npm run mvp:gate -- --health-url http://127.0.0.1:3100/health
```

JSON and Markdown reports are written to `memory/mvp-gate/reports/`.

---

## Hard Gate Criteria (Blockers)

All of the following **must pass** before a release is declared ready. Any failure produces a `no-go` verdict.

| # | Criterion | Check ID | Pass Condition | Evidence |
|---|---|---|---|---|
| 1 | **TypeScript Build** | `build` | `npm run build` exits 0 with zero compiler errors | `dist/` contains compiled output |
| 2 | **Test Suite** | `tests` | `npm run test` exits 0 with 0 failures | Vitest summary — all tests pass |
| 3 | **Required NPM Scripts** | `npm-commands` | `build`, `test`, `start`, `release:preflight`, `release:prepare`, `release:rollback` all present in `package.json` | `package.json#scripts` |
| 4 | **Environment Template** | `env-config` | `.env.example` exists and documents required environment variables | `.env.example` |
| 5 | **Interface Readiness** | `interface-readiness` | `gui/package.json`, `src/interfaces/dispatcher.ts`, `mcp-servers.json` all present | File existence check |
| 6 | **API Health** *(if server running)* | `api-health` | `GET /health` returns HTTP 200 with `{"data":{"status":"ok"}}` | HTTP response |

> **Note:** `api-health` only activates as a hard gate when `--health-url` is explicitly provided. For local-first runs it is skipped.

---

## Advisory Criteria (Non-Blocking)

Failures here produce an `advisory-only` verdict — the gate passes but items should be tracked.

| # | Criterion | Check ID | Advisory Threshold | Owner Track |
|---|---|---|---|---|
| 7 | **Build Artifacts Present** | `dist-artifact` | `dist/` exists and is non-empty | Track 35 |
| 8 | **Test Coverage** | `test-coverage` | lines/functions/branches/statements ≥ 25% | Track 43 |
| 9 | **Doctor/Onboarding Module** | `doctor-readiness` | `src/core/onboarding.ts` exists | Track 23 |

---

## Smoke Scenario Matrix

These deterministic file-existence checks verify core runtime assets are in place. They are evaluated on every gate run.

| Scenario ID | Asset Verified | Pass Condition |
|---|---|---|
| `core:package-manifest` | `package.json` | File exists |
| `core:mcp-config` | `mcp-servers.json` | File exists |
| `core:env-template` | `.env.example` | File exists |
| `runtime:interface-dispatcher` | `src/interfaces/dispatcher.ts` | File exists |
| `runtime:release-cli` | `src/release/cli.ts` | File exists |
| `runtime:db-service` | `src/services/db.ts` | File exists |
| `runtime:gateway` | `src/core/gateway.ts` | File exists |

---

## Failure Triage Ownership

When a check fails, the gate report emits a triage entry with the owning track and a concrete next action. Use this table as a quick reference.

| Check | Owning Track | Next Action |
|---|---|---|
| `build` | Track 35: Build Contract Recovery | Fix TypeScript errors; run `npm run build` |
| `tests` | Track 36: Test Harness FK Integrity | Fix failing specs; run `npm test` |
| `api-health` | Track 41: Runtime Health & Doctor | Start runtime; verify `GET /health` |
| `interface-readiness` | Track 35: Build Contract Recovery | Ensure all critical interface files exist |
| `npm-commands` | Track 38: NPM Command Reliability | Add missing scripts to `package.json` |
| `env-config` | Track 40: Config & Env Validation | Create/restore `.env.example` |
| `dist-artifact` | Track 35: Build Contract Recovery | Run `npm run build` to populate `dist/` |
| `test-coverage` | Track 43: Coverage Gap Closure | Run `npm run test:coverage` and close gaps |
| `doctor-readiness` | Track 23: CLI Hardening & Doctor | Wire `src/core/onboarding.ts` entrypoint |

---

## Release Decision Protocol

### Verdict: `go` 🟢

All hard gates passed, no advisory failures.

- [ ] Review JSON report in `memory/mvp-gate/reports/latest.json`
- [ ] Tag the release commit: `git tag -a v<version> -m "MVP release"`
- [ ] Run `npm run release:prepare` to capture a runtime snapshot
- [ ] Announce release and activate post-release monitoring

### Verdict: `advisory-only` 🟡

All hard gates passed; one or more advisories are failing.

- [ ] Review advisory failures in the report triage section
- [ ] Determine if any advisory item rises to a blocker for this release
- [ ] If proceeding: document deferred items in the release notes
- [ ] Follow the same go steps as above

### Verdict: `no-go` 🔴

One or more hard gates failed. **Do not release.**

1. Identify the blocking check(s) from the report's `failedHardGates` list.
2. Route each failure to its owning track using the triage table above.
3. Once each blocker is resolved, re-run `npm run mvp:gate`.
4. Only proceed when the gate returns `go` or `advisory-only`.

---

## Deferred Items & Post-MVP Backlog

Non-blocking items that should be resolved in the first patch cycle after MVP:

| Item | Owner | Priority |
|---|---|---|
| Increase test coverage threshold from 25% to 60% | Track 43 | High |
| Add `api-health` to the default hard-gate (no `--health-url` flag required) | Track 41 | Medium |
| Wire `--doctor` flag to onboarding CLI for self-diagnosis | Track 23 | Medium |
| Integrate `npm run mvp:gate` into CI workflow | Track 38/44 | Medium |

---

## Evidence Bundle Location

Every gate run writes an immutable evidence bundle to:

```
memory/mvp-gate/reports/
  mvp_gate_<timestamp>.json    ← Machine-readable gate report
  mvp_gate_<timestamp>.md      ← Human-readable Markdown summary
  latest.json                  ← Pointer to the most recent run
```

These files serve as the audit trail for release decisions.
