# Specification: Windows-Only Documentation Alignment

## Goal
Align operator and architecture documentation with a Windows-only support policy.

## Requirements
- Remove Linux/macOS platform references from active documentation.
- Convert command examples to PowerShell-oriented snippets.
- Use Windows paths for workspace and config examples.
- Keep archived conductor tracks untouched as historical records.

## Acceptance Criteria
- `README.md` quick start is Windows-only.
- `docs/configuration-guide.md` uses Windows paths and PowerShell environment examples.
- Release/rotation/checklist runbooks use PowerShell code fences.
- PRD/blueprint roadmap docs no longer advertise Linux/macOS support.

## Out of Scope
- Rewriting archived track specs/plans.
- Updating third-party skill package docs not tied to TwinClaw runtime behavior.
