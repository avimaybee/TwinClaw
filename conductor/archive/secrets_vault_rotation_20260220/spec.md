# Specification: Secrets Vault, Rotation & Runtime Redaction Policy

## Overview
This track adds a secure secret-management layer for local/runtime operations with rotation workflows and strict redaction rules to prevent key leakage in logs, prompts, and diagnostics.

## Requirements
- Add a typed secret registry with metadata (name, scope, source, rotation window, last-rotated timestamp).
- Add secure storage abstraction for secret values with non-plaintext persistence guarantees.
- Add CLI workflows for set/list/rotate/revoke secrets with validation and audit events.
- Add runtime redaction policy that removes secret material from logs, diagnostics, and model/tool payload traces.
- Add preflight checks that block startup when required secrets are missing or expired.

## Technical Mandates
- Centralize secret reads/writes in one service layer.
- Never emit raw secret values in any error path.
- Ensure rotation is atomic with clear rollback semantics on failure.
- Add deterministic tests for redaction, expiration gates, and rotation flows.
