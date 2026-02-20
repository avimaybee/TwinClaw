# Implementation Plan: Persistent Semantic Memory & RAG

## Phase 1: sqlite-vec Setup & Schema
- [x] **Task: Install and Configure sqlite-vec**
  - [x] Add `sqlite-vec` binary dependencies.
  - [x] Initialize `vec0` virtual tables for memory embeddings.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Embedding Generation
- [x] **Task: Incorporate Embedding Provider**
  - [x] Support local embeddings (e.g., Ollama `mxbai-embed-large`) or remote APIs.
  - [x] Implement chunking and vectorization logic for completed tasks and conversations.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: RAG Retrieval Integration
- [x] **Task: Context Injection**
  - [x] Execute `vec_distance` KNN queries to fetch relevant history on new prompts.
  - [x] Inject retrieved context into the LLM system prompt.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
