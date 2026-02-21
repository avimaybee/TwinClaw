# Plan: CI Release Gate Enforcement

1. **Update GHA Workflows**  
   - [x] Add `run mvp:gate --ci` step to `.github/workflows/main.yml`.  
   - [x] Configure it to fail on any non-"go" verdict.  

2. **Upload Evidence Artifacts**  
   - [x] Ensure `mvp:gate` outputs a JSON report.  
   - [x] Upload this report as a workflow artifact.  

3. **Verify Gate Integration**  
   - [x] Run a sample PR that purposefully fails the gate.  
   - [x] Ensure the CI stops the merge as expected.

## Completion Notes
- CI now runs `npm run mvp:gate -- --ci`, parses deterministic report artifacts, uploads JSON/Markdown evidence, and writes a job summary.
- Workflow fails for any verdict other than `go`, matching release gate enforcement requirements.
