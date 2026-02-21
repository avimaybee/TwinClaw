# Implementation Plan: PRD + Blueprint Architectural Docs Migration

## Phase 1: PRD Migration Edits
- [x] **Task: Update PRD Identity/State & Messaging Security Sections**
  - [x] Revise Section 4.3 to enforce `~/.twinclaw/twinclaw.json` as single config source.
  - [x] Revise Section 4.6 to codify `dmPolicy: "pairing"` and approval command workflow.
- [x] **Task: Update PRD Security + Roadmap Sections**
  - [x] Revise Section 6 to remove dotenv-vault references and emphasize local config permissions.
  - [x] Revise Section 7 Phase 1 to prioritize `twinclaw onboard`/config generation.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Blueprint Migration Edits
- [ ] **Task: Update Step 1 Configuration Guidance**
  - [ ] Replace `.env` setup flow with wizard-first onboarding contract.
  - [ ] Add `twinclaw channels login` and `twinclaw doctor` as first-run standard commands.
- [ ] **Task: Update Natural Language Setup Narrative**
  - [ ] Replace manual whitelist/user-info bot flow with pairing challenge/approve flow.
  - [ ] Ensure first-run sequence mirrors intended operational UX.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Consistency Pass & Approval Packaging
- [ ] **Task: Cross-Document Terminology Consistency Audit**
  - [ ] Ensure command names, path names, and policy labels match PRD and blueprint.
  - [ ] Remove stale `.env`/dotenv-vault references from modified sections.
- [ ] **Task: Publish Documentation Delta Summary**
  - [ ] Summarize key architecture deltas for release stakeholders.
  - [ ] Prepare review-ready diff set for lead approval.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
