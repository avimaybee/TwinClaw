# Implementation Plan: Message Streaming, Chunking, & Queueing Adoption

## Phase 1: Inbound Debouncing
- [x] **Task: Define Inbound Config Flags**
  - [x] Add `messages.inbound.debounceMs` schema keys.
- [x] **Task: Implement Debounce Layer**
  - [x] Introduce a generic debounce/batch queue in the `Dispatcher` to catch messages arriving on the same `chatId` within `debounceMs`.
  - [x] Combine contiguous text strings together before sending them down to the Gateway.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Embedded Chunker Implementation
- [x] **Task: Build `EmbeddedBlockChunker`**
  - [x] Build the chunking logic respecting `minChars`, `maxChars`, and paragraph/sentence break preferences.
  - [x] Safely handle markdown constraints (e.g., never leaving unmatched code fences).
- [x] **Task: Connect Model Deltas to Dispatcher**
  - [x] Switch TwinClaw models to `stream: true` implementations where supported.
  - [x] Pipe these output text deltas through the chunker.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Outbound Coalescing & Rate Limiting
- [x] **Task: Apply Human Delays & Batch Sending**
  - [x] Wire the `agents.defaults.humanDelay`. For each chunk produced, pause the loop accordingly before triggering the `telegram_handler` or `whatsapp_handler`.
  - [x] Implement `blockStreamingCoalesce` to merge tiny fragments.
- [x] **Task: E2E Streaming Tests**
  - [x] Write harness tests proving big model replies are chunked cleanly and delivered in sequence.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
