# TwinClaw Agent Collaboration Guide

Welcome to the TwinClaw development environment. This project uses the **Conductor** methodology to manage parallel development across multiple autonomous agents.

## 🚀 The Conductor Workflow
Every task you execute must follow the **Plan -> Act -> Validate** cycle:

1.  **Read Context:** Always start by reading the `conductor/index.md` to understand the project's current state.
2.  **Select a Track:** Work is organized into **Tracks**. Find your assigned track in `conductor/tracks.md`.
3.  **Follow the Plan:** Each track has a `plan.md` in its corresponding directory under `conductor/tracks/`. Do not deviate from the plan without updating the documentation first.
4.  **Surgical Changes:** Make targeted changes. Adhere strictly to the `conductor/code_styleguides/`.
5.  **Verify & Checkpoint:** After completing a task, run tests and update the task status in the `plan.md`. Major phases require a manual verification protocol as defined in `conductor/workflow.md`.

## 🛠️ Key Technical Mandates
- **Zero-Cost First:** Always prioritize free-tier API fallbacks (OpenRouter, Google AI Studio) and local model routing.
- **Local-First Persistence:** Use SQLite (`better-sqlite3`) for data and human-readable Markdown files for agent identity.
- **Radical Transparency:** Every system command you execute must be logged to the daily transcript (`memory/YYYY-MM-DD.md`).
- **LEGO-Block Modularity:** Design all skills and features as decoupled modules that can be "plugged in" to the core gateway.

## 📂 Project Structure
- `/conductor`: Project management, guidelines, and track plans.
- `/docs`: High-level PRDs and blueprints.
- `/src`: The core TypeScript application.
- `/memory`: Persistent agent state and history.

## 🤝 Communication
If you encounter an architectural conflict or need a new global utility, flag it for the lead agent. Do not duplicate logic that already exists in other tracks.
