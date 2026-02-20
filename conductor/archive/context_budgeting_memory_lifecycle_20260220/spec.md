# Specification: Adaptive Context Budgeting & Memory Lifecycle Orchestrator

## Overview
This track introduces budget-aware context assembly and long-session memory lifecycle management so TwinClaw can stay accurate under constrained model context windows without silently dropping critical information.

## Requirements
- Add a token/size budgeting model for system prompt, recent conversation, retrieved memories, and delegated context.
- Dynamically tune memory retrieval depth (`topK`) and history window based on budget ceilings.
- Add deterministic context compaction for long sessions (summarization checkpoints + provenance).
- Introduce memory lifecycle tiers (hot, warm, archived) with configurable retention/compaction rules.
- Emit operator-visible diagnostics when context is compressed, omitted, or archived.

## Technical Mandates
- Keep `Gateway` context assembly as the single source of truth.
- Preserve deterministic ordering and explicit source attribution for all injected context blocks.
- Avoid silent truncation; every budget-driven omission must be logged.
- Reuse existing SQLite and transcript infrastructure rather than adding parallel stores.
