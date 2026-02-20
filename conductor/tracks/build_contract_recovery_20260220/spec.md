# Specification: Build Contract Recovery & Compile Unblock

## Overview
This track restores a green TypeScript build by fixing contract drift and typing regressions that currently block `npm run build` and downstream validation.

## Requirements
- Fix `src/core/onboarding.ts` to match the current `assembleContext` contract.
- Fix `src/services/secret-vault.ts` incorrect `better-sqlite3` `Database` typing usage.
- Ensure `npm run build` succeeds without TypeScript errors.
- Preserve existing runtime behavior while resolving compile blockers.

## Technical Mandates
- Prefer minimal, surgical changes in affected files.
- Reuse existing types/helpers from context and secret-vault layers.
- Add/adjust targeted tests if contract behavior changes.
- Document root-cause and compatibility notes in track artifacts.
