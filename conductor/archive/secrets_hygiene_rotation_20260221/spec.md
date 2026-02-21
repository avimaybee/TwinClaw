# Specification: Secrets Hygiene & Credential Rotation Sweep

## Goal
To maintain a leak-free repository by removing placeholder secrets and providing clear, automated instructions for secret rotation.

## Requirements
- **Documentation:** All `docs/` and examples must use generic placeholders that cannot be mistakenly used.
- **Rotation:** A runbook must be provided for every supported AI and messaging provider.
- **Scanning:** An automated script must catch sensitive code patterns before they are committed.

## Constraints
- Runbook must be non-interactive and printable.
- Scanner must have zero false-positive rate for known public API keys.
