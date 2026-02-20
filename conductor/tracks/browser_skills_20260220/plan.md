# Implementation Plan: Browser Autonomy & System Skills (browser_skills_20260220)

## Phase 1: Browser & Vision Implementation
- [ ] **Task: Integrate Playwright (Browser Automation)**
  - [ ] Implement `src/services/browser-service.ts` using Playwright.
  - [ ] Write logic for basic web surfing and accessibility tree parsing.
- [ ] **Task: Vision Language Model (VLM) Screenshots**
  - [ ] Implement screenshot-taking logic for multimodal model analysis.
  - [ ] Integrate coordinate mapping for mouse clicks based on VLM responses.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1: Browser & Vision Implementation' (Protocol in workflow.md)**

## Phase 2: System Skills & Logic
- [ ] **Task: Build System Skill Library**
  - [ ] Implement a base `Skill` interface and a `child_process.exec` wrapper.
  - [ ] Create initial skills: `read_file`, `list_files`, `shell_execute`.
- [ ] **Task: Daily Transcript Logging**
  - [ ] Implement the `src/utils/logger.ts` for automatic daily transcript logging.
  - [ ] Log every system command, thought process, and tool call.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2: System Skills & Logic' (Protocol in workflow.md)**

## Phase 3: Proactive Heartbeat Integration
- [ ] **Task: Integrate Node-Cron Heartbeat**
  - [ ] Implement `src/core/heartbeat.ts` for proactive daily reminders.
  - [ ] Ensure the agent can message the user independently of incoming prompts.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3: Proactive Heartbeat Integration' (Protocol in workflow.md)**
