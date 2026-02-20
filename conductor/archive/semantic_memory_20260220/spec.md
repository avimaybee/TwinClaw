# Specification: Persistent Semantic Memory & RAG

## Overview
This track implements long-term factual memory using `sqlite-vec` to provide K-Nearest Neighbor (KNN) search directly within SQLite. The goal is to give the TwinClaw agent persistent recall of facts, user preferences, and historical tool outputs without relying on external vector database services like ChromaDB or Pinecone.

## Requirements
- Maintain zero-dependency serverless posture by embedding vector search within SQLite.
- Seamlessly index conversation summaries and workflow results as `Float32` arrays.
- On each user request, perform a semantic search to retrieve the top-K relevant memories.
- Keep the database performant using SIMD-accelerated L2 Euclidean distance searches.
