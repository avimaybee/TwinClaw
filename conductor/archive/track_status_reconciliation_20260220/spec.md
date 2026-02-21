# Specification: Conductor Track Status Reconciliation & Recovery

## Overview
This track reconciles drift between `tracks.md`, track folders, plan checkbox states, and archive placement to restore trustworthy project coordination.

## Requirements
- Audit every active/completed track entry against actual directory artifacts.
- Repair mismatched statuses, missing links, and stale assignment metadata.
- Reconcile plan checkbox progress with real codebase state for impacted tracks.
- Add a lightweight consistency protocol/check to prevent future drift.

## Technical Mandates
- Preserve historical context; avoid destructive deletion of track artifacts.
- Record all reconciliations with explicit rationale in track notes.
- Keep links and track IDs stable where possible.
- Ensure registry updates are atomic and easy to review.
