# Plan: Secrets Hygiene & Credential Rotation Sweep

1. **Audit Documentation & Examples**  
   - [x] Scan `docs/`, `conductor/`, and `gui/README.md` for placeholder secrets ("your_api_key_here").  
   - [x] Replace placeholders with non-sensitive identifiers or descriptive text.  

2. **Establish Rotation Runbook**  
   - [x] Create `docs/rotation-runbook.md`.  
   - [x] Define rotation steps for Telegram Tokens, OpenRouter Keys, and ElevenLabs.  

3. **Implement Secret-Scan Preflight**  
   - [x] Write `src/utils/secret-scan.ts` to detect patterns of sensitive data in the codebase.  
   - [x] Add `npm run check:secrets` as a preflight script.  

4. **Verify Hygiene**  
   - [x] Run `npm run check:secrets` on the repository to verify zero leaks.  

## Completion Notes
- Added deterministic repository secret scanner with placeholder-aware filtering to reduce false positives.
- Added `check:secrets` and integrated it into `npm run check`.
- Refreshed credential rotation runbook with non-interactive secret-vault commands for runtime/model/messaging credentials.
