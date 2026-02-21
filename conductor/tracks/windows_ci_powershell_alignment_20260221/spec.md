# Specification: Windows CI Runner & PowerShell Pipeline Alignment

## Goal
Align CI release-gate execution with the Windows-only platform policy.

## Requirements
- CI workflow must run on a Windows GitHub runner.
- MVP gate orchestration/parsing/summarization steps must use PowerShell-compatible scripts.
- Workflow failure semantics (non-`go` verdict or non-zero command exit) must be preserved.

## Acceptance Criteria
- `.github/workflows/main.yml` uses `runs-on: windows-latest`.
- Workflow steps avoid bash-only syntax (`set +e`, heredocs, POSIX conditionals).
- Output parsing still exports `verdict`, `summary`, `failed_count`, and `report_path`.

## Out of Scope
- Cross-platform CI matrix coverage.
- Changes to release-gate semantics unrelated to platform handling.
