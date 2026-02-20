# Specification: WhatsApp Interface Adapter & Unified Dispatch Expansion

## Overview
This track adds a WhatsApp adapter that plugs into the existing dispatcher contract so Telegram and WhatsApp share the same normalized processing pipeline.

## Requirements
- Implement a WhatsApp inbound adapter with normalized `InboundMessage` output.
- Extend dispatcher wiring so multiple interface adapters can register cleanly.
- Preserve platform-specific reply routing while reusing shared transcription and gateway logic.
- Add secure sender validation and operational logging consistent with Telegram handling.

## Technical Mandates
- Keep the dispatcher as the only interface-to-gateway bridge.
- Avoid duplicate message normalization logic across adapters.
- Preserve backward compatibility for Telegram behavior.
