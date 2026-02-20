# Specification: Local State Snapshot, Backup & Recovery Automation

## Overview
This track introduces local-first backup and restore workflows for TwinClaw runtime state so operators can recover quickly from corruption, bad upgrades, or host failures without losing identity, memory, and control-plane continuity.

## Requirements
- Add a snapshot manifest contract covering critical local state (`identity/`, `memory/`, SQLite runtime data, policy profiles, MCP config, and skill package lock/catalog files).
- Add manual and scheduled snapshot workflows with retention rules and deterministic snapshot naming.
- Add integrity validation (checksums + manifest verification) before any restore operation.
- Add restore workflow with dry-run mode, selective scope restore, and rollback on partial restore failure.
- Add operator-facing diagnostics for last successful snapshot, restore history, validation failures, and recommended recovery actions.

## Technical Mandates
- Keep backup/restore fully local-first with no mandatory cloud dependency.
- Ensure snapshot manifests avoid leaking raw secret values and follow existing redaction rules.
- Perform restores through staged writes and atomic swaps to avoid half-applied runtime state.
- Add deterministic regression tests for snapshot reproducibility, restore idempotence, and rollback correctness.
