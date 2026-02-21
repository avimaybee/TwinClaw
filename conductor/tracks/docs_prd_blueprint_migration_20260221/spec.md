# Specification: PRD + Blueprint Architectural Docs Migration

## Overview
This track updates core architectural documents to formalize the migration from `.env`/dotenv-vault setup to wizard-driven `twinclaw.json` configuration and pairing-based DM access control.

## Requirements
- Update `docs/PRD.md` sections 4.3, 4.6, 6, and 7 to reflect `~/.twinclaw/twinclaw.json`, pairing policy, and wizard-first onboarding.
- Update `docs/TwinClaw-blueprint.md` Step 1 and natural-language setup guidance to mandate `twinclaw onboard`, `channels login`, and `doctor`.
- Remove obsolete references to manual whitelist extraction and dotenv-vault-centered setup flows.
- Ensure terminology is consistent across PRD and blueprint (commands, policy names, config path semantics).

## Technical Mandates
- Preserve document structure and existing intent; perform targeted, non-disruptive edits.
- Keep command names and policy labels consistent with implemented CLI/runtime contracts.
- Avoid introducing architecture claims not represented in codebase plans/tracks.
- Maintain operator-safe guidance (no secret-sharing instructions).
