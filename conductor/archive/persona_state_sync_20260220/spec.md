# Specification: Persona Source-of-Truth Sync & Profile State Management

## Overview
This track closes a core product gap by turning TwinClaw's persona files (`soul.md`, `identity.md`, `user.md`) into first-class, operator-safe runtime state surfaces across control-plane APIs and GUI editing workflows.

## Requirements
- Add typed control-plane APIs to read and update persona source-of-truth files (`soul.md`, `identity.md`, `user.md`) with explicit validation and error reporting.
- Add deterministic write safeguards (staged write + backup/rollback on failure) so partial file corruption is prevented.
- Replace GUI persona placeholders with live read/write integration backed by the new APIs, including save status and actionable validation feedback.
- Add audit entries for persona mutations in local logs so identity changes remain transparent and traceable.
- Keep the workflow idempotent for reruns and restarts (no duplicate state inflation, no silent overwrite behavior).

## Technical Mandates
- Reuse existing local-first storage conventions and keep all persona state in local Markdown files.
- Enforce strict input contracts for persona updates and preserve existing markdown readability.
- Ensure all mutation paths produce explicit outcomes (success, validation error, write failure) with no silent failure modes.
- Add deterministic regression tests for API validation, rollback behavior, and GUI save/reload flows.

## Out of Scope
- Cloud sync of persona files.
- Multi-user profile sharing.
- Replacing existing onboarding conversation logic.
