# Specification: Cross-Session Reasoning Graph & Evidence-Aware Retrieval

## Overview
This track introduces a structured reasoning graph that links entities, claims, and tool outputs across sessions so TwinClaw can retrieve context with explicit evidence provenance instead of only nearest-vector similarity.

## Requirements
- Persist graph nodes for entities, facts, tasks, and tool-result artifacts with stable identifiers.
- Persist typed relationships (`supports`, `contradicts`, `depends_on`, `derived_from`) with timestamps.
- Add retrieval that blends vector similarity with graph evidence ranking and recency weighting.
- Return evidence-backed memory snippets with provenance references in prompts and diagnostics.
- Add conflict detection for contradictory facts and surface safe resolution hints.

## Technical Mandates
- Reuse existing SQLite substrate and semantic memory services; avoid parallel persistence stacks.
- Keep graph updates deterministic and idempotent for replayability.
- Preserve explicit provenance IDs in all retrieved evidence bundles.
- Add bounded graph traversal to avoid runaway query costs.
