# Implementation Plan: WhatsApp Interface Adapter & Unified Dispatch Expansion

## Phase 1: WhatsApp Adapter Foundation
- [x] **Task: Add WhatsApp Handler**
  - [x] Create `src/interfaces/whatsapp_handler.ts` adapter.
  - [x] Normalize inbound payloads into `InboundMessage`.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Dispatcher Multi-Adapter Wiring
- [x] **Task: Expand Dispatcher Registration**
  - [x] Refactor dispatcher constructor to support multiple adapters.
  - [x] Keep STT + gateway flow centralized and unchanged.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Outbound Routing & Hardening
- [x] **Task: Platform Reply + Proactive Send**
  - [x] Implement WhatsApp outbound text routing.
  - [x] Add logging and security checks for sender identity.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
