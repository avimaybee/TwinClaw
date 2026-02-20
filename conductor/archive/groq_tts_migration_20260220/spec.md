# Specification: Groq TTS Migration & Voice Pipeline Alignment

## Overview
This track migrates TwinClaw's text-to-speech provider from ElevenLabs to Groq Audio Speech so voice synthesis uses the existing `GROQ_API_KEY` and remains aligned with the zero-cost-first architecture.

## Requirements
- Replace the ElevenLabs-backed implementation in `src/services/tts-service.ts` with Groq Audio Speech synthesis.
- Keep the existing `TtsService.synthesize(text)` contract returning `Promise<Buffer>`.
- Align outbound voice-message metadata to the new WAV output format.
- Preserve compatibility with the current dispatcher wiring (`new TtsService(groqApiKey)`).

## Technical Mandates
- Default model must be `canopylabs/orpheus-v1-english`.
- Default voice must be `autumn`.
- Response format must be `wav`.
- No new API keys are introduced; use the existing `GROQ_API_KEY` path.
