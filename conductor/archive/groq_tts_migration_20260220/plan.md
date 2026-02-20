# Implementation Plan: Groq TTS Migration & Voice Pipeline Alignment

## Phase 1: Protocol Review & Remaining Scope Audit
- [x] **Task: Validate Conductor Context**
  - [x] Read `conductor/conductor-new-track.md` and `conductor/conductor.md` to follow track lifecycle protocol.
  - [x] Review `conductor/tracks.md` and active/archived folders to avoid duplicating previously completed tracks.
- [x] **Task: Confirm Runtime Secret Path**
  - [x] Verify `GROQ_API_KEY` is present in `.env` and `.env.example`.
  - [x] Confirm dispatcher startup wiring already sources `GROQ_API_KEY` for STT/TTS initialization.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Groq TTS Service Migration
- [x] **Task: Replace ElevenLabs TTS Backend**
  - [x] Rework `src/services/tts-service.ts` to call `groq.audio.speech.create`.
  - [x] Set defaults to model `canopylabs/orpheus-v1-english`, voice `autumn`, and `wav` response format.
- [x] **Task: Align Voice Message Metadata**
  - [x] Update Telegram voice upload metadata to WAV.
  - [x] Update WhatsApp voice media metadata to WAV.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Verification, Documentation & Track Closure
- [x] **Task: Update Project Context**
  - [x] Update `conductor/tech-stack.md` voice stack description to Groq-first TTS/STT.
  - [x] Keep archived implementation history intact while documenting current runtime behavior.
- [x] **Task: Validate Change Safety**
  - [x] Use editor diagnostics to confirm no new TypeScript errors were introduced in touched source files.
  - [x] Record that shell-based build/test execution is blocked in this environment due missing `pwsh`.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
