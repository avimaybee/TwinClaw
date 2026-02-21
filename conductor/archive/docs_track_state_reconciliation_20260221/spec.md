# Specification: Docs & Track-State Reconciliation

## Goal
To maintain a single, consistent, and accurate source of truth for the project's architecture, roadmap, and current state.

## Requirements
- **Consistency:** `tracks.md` must match the physical folders in `conductor/tracks/`.
- **Integrity:** Checklist IDs in `docs/` must remain deterministic.
- **Archival:** Completed work must be moved to the archive.

## Technical Mandates
- Do not lose history during archival.
- All docs should be human-readable Markdown.
