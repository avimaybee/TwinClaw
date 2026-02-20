# Specification: Core Orchestration & Persona-Building (core_persona_20260220)

## Overview
This track focuses on building the foundational engine for TwinClaw. It includes initializing the TypeScript environment, setting up the model routing layer (LiteLLM), and creating the interactive onboarding flow that defines the agent's identity.

## Requirements
- **Node.js/TypeScript Environment:** ES2022+ with ESM support.
- **Model Routing Engine:** Integration with LiteLLM to handle OpenRouter, Google AI Studio, and Modal fallbacks.
- **Persona-Building Flow:** An interactive onboarding sequence that populates `soul.md` and `user.md`.
- **State Persistence:** SQLite-backed session management for basic conversation history.

## Technical Mandates
- **Zero-Cost First:** Must support simple-shuffle routing to bypass rate limits on free-tier APIs.
- **Local-First Identity:** The agent's persona must be derived from human-readable Markdown files.
- **Strict Typing:** All model interactions must use defined TypeScript interfaces.
