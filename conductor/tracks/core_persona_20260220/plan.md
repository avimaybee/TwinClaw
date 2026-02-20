# Implementation Plan: Core Orchestration & Persona-Building (core_persona_20260220)

## Phase 1: Environment & Scaffolding
- [x] **Task: Initialize Node.js/TypeScript Environment**
  - [x] Run `npm init -y` and configure `tsconfig.json` for ES2022/ESM.
  - [x] Install base dependencies: `typescript`, `ts-node`, `dotenv-vault`, `better-sqlite3`, `ws`, `express`.
  - [x] Create initial directory structure: `src/`, `src/core/`, `src/services/`, `src/utils/`, `memory/`.
- [x] **Task: Dockerization & Persistent Storage**
  - [x] Write `Dockerfile` and `docker-compose.yml`.
  - [x] Map local `./memory` volume to `/app/src/memory`.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1: Environment & Scaffolding' (Protocol in workflow.md)**

## Phase 2: LiteLLM Router Implementation
- [ ] **Task: Configure LiteLLM/OpenRouter Layer**
  - [ ] Implement `src/services/model-router.ts` for provider abstraction.
  - [ ] Integrate simple-shuffle routing logic for OpenRouter, Google AI Studio, and Modal.
  - [ ] Implement error handling for 429 status codes with automated fallback.
- [ ] **Task: Build Tool-Calling Abstraction**
  - [ ] Define standardized tool-call interfaces in `src/core/types.ts`.
  - [ ] Implement the `await` resolution loop for serial tool execution ("Lanes").
- [ ] **Task: Conductor - User Manual Verification 'Phase 2: LiteLLM Router Implementation' (Protocol in workflow.md)**

## Phase 3: Persona-Building & State Persistence
- [ ] **Task: Implement Initial Onboarding Flow**
  - [ ] Create logic for the persona-building session to collect user preferences.
  - [ ] Implement the context-assembly function that reads `soul.md` and `user.md`.
- [ ] **Task: SQLite Memory Integration**
  - [ ] Initialize `sessions` and `messages` tables in `better-sqlite3`.
  - [ ] Write basic message persistence and retrieval logic.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3: Persona-Building & State Persistence' (Protocol in workflow.md)**
