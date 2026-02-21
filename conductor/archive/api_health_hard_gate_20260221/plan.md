# Plan: API Health as Default Hard Gate

1. **Modify Startup Probe Flow**  
   - [x] Update `src/index.ts` to include a required health check phase.  
   - [x] Implement a grace period for initialization.  

2. **Integrate with Release Gate**  
   - [x] Mandate API health in `mvp:gate` checks.  
   - [x] Ensure `Go/No-Go` is dependent on healthy API status.  

3. **Verify Reliability**  
   - [x] Test the startup sequence on different machines.  
   - [x] Fail startup if probe does not pass within 30 seconds.  
