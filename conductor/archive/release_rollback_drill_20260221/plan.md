# Plan: Release/Rollback Drill Automation

1. **Implement Rollback Mock CLI**  
   - [x] Add `npm run release:drill` command.  
   - [x] Simulate a failed deploy and trigger the rollback flow.  

2. **Snapshot Integrity Checks**  
   - [x] Audit `local-state-backup.ts` to ensure it captures all critical data.  
   - [x] Verify snapshot restoration in the rollback drill.  

3. **Validate Runbook Parity**  
   - [x] Verify `docs/release-rollback-runbook.md` instructions against the drill's automated actions.  
   - [x] Identify and fix any discrepancies.  

## Completion Notes
- `release:drill` automation is implemented in release CLI/service with audit logging and integrity checks.
- Release rollback runbook now documents automated drill execution and expected evidence paths.
