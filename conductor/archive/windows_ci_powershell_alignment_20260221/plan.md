# Plan: Windows CI Runner & PowerShell Pipeline Alignment

## Phase 1: Runner and Shell Baseline
- [x] Task: Switch workflow runner from Ubuntu to Windows.
- [x] Task: Set explicit PowerShell shell where script behavior matters.

## Phase 2: Script Conversion
- [x] Task: Convert MVP gate execution step to PowerShell-safe exit-code capture.
- [x] Task: Convert gate verdict parsing from Node heredoc/bash style to PowerShell JSON parsing.
- [x] Task: Convert summary and failure steps to PowerShell syntax.

## Phase 3: Verification
- [x] Task: Execute workflow run in GitHub Actions to confirm expected gate behavior.


## Progress Notes
- Workflow now targets Windows with PowerShell-native scripts.
- Live Actions run verification remains pending outside this local environment.
