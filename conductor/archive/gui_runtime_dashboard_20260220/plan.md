# Implementation Plan: Live GUI Control Plane Dashboard & Runtime Controls

## Phase 1: GUI Data Service Foundation
- [x] **Task: Add Typed Control Plane API Client**
  - [x] Create GUI service helpers for `/health` and `/reliability` endpoints.
  - [x] Add envelope parsing and typed error mapping.
- [x] **Task: Add Polling/Refresh Hook**
  - [x] Implement bounded polling with visibility-aware refresh behavior.
  - [x] Surface transport and API errors in a normalized view model.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Dashboard Surface Integration
- [x] **Task: Replace Static Status Blocks**
  - [x] Render live backend status, uptime, skill counts, and MCP server states.
  - [x] Render live reliability metrics and recent delivery outcomes.
- [x] **Task: Improve Offline UX**
  - [x] Add clear disconnected/error banners and retry actions.
  - [x] Keep core navigation usable while data is unavailable.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Runtime Controls & Hardening
- [x] **Task: Add Safe Runtime Actions**
  - [x] Add explicit refresh/reload controls tied to the data service.
  - [x] Gate mutating controls behind clear confirmations and disabled states.
- [x] **Task: Add GUI Test Coverage**
  - [x] Add unit tests for service parsing/error handling and dashboard state transitions.
  - [x] Add integration tests for polling lifecycle and offline recovery.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
