# Specification: Identity Bootstrap Compliance

## Goal
To guarantee that every TwinClaw agent has a baseline persona and memory system from its first boot.

## Requirements
- **Boot:** Onboarding must create `soul.md`, `identity.md`, and `memory.md` if they do not exist.
- **Doctor:** Must include a readiness check for these files.
- **Templates:** Use standard OpenClaw-compatible Markdown templates.

## Technical Mandates
- File creation must be non-destructive (do not overwrite existing files).
- Defaults should specify neutral, safe behaviors.
