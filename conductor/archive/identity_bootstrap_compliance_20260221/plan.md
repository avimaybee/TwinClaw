# Plan: Identity Bootstrap Compliance

1. **Bootstrap Defaults**  
   - [x] Update `src/core/onboarding.ts` to create `identity/soul.md` with a template.  
   - [x] Create `identity/identity.md` and `memory/memory.md` upon initialization.  

2. **Integration with Workspace**  
   - [x] Use `~/.twinclaw/workspace` as the base for these files.  
   - [x] Ensure files are human-readable and easily editable.  

3. **Verify Compliance**  
   - [x] Add `doctor` checks to verify all mandatory identity files exist.  
   - [x] Prompt user to re-run onboarding if they are deleted.  

## Completion Notes
- Identity bootstrap templates and non-destructive file creation are implemented in `src/config/identity-bootstrap.ts`.
- Doctor filesystem checks include identity + memory files with onboarding remediation guidance.
