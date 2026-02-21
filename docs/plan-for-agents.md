# TwinClaw Multi-Agent Implementation Roadmap

This document translates the TwinClaw Product Requirements Document (PRD) and the C.L.A.W.S. framework blueprint into a highly structured, parallelized roadmap. It is specifically designed so that multiple autonomous AI agents can work on distinct components of the system simultaneously without causing merge conflicts or architectural drift.

## Multi-Agent Work Streams

The implementation is divided into four distinct **Execution Streams**. Agents can be assigned to these streams in parallel.

---

### Stream Alpha: Core Infrastructure & Backend Services
**Focus:** Foundation, Database, and Routing.

*   **Phase A1: Environment Initialization (Agent 1)**
    *   [ ] Initialize Node.js environment (`npm init -y`) with TypeScript configured for ES2022 (top-level await).
    *   [ ] Implement the `twinclaw onboard` interactive CLI wizard to securely collect API keys and workspace settings.
    *   [ ] Build the `twinclaw.json` configuration manager to persist settings in `~/.twinclaw/` (replacing `.env`).
    *   [ ] Write `Dockerfile` and `docker-compose.yml`, explicitly mapping a local `./memory` volume to `/app/src/memory` for persistent state and config.
*   **Phase A2: LLM Routing & Native Tool Calling (Agent 1)**
    *   [ ] Install and configure LiteLLM Proxy or build an internal routing abstraction.
    *   [ ] Implement the routing array: Primary (`zai-org/GLM-5-FP8` via Modal), Fallback (`step-3.5-flash` via OpenRouter), Deep Context (`gemini-flash-lite-latest`).
    *   [ ] Write error-handling logic to automatically retry `429 Too Many Requests` status codes with the next available model in the array.
*   **Phase A3: Memory Subsystem (Agent 1)**
    *   [ ] Install `better-sqlite3` and `sqlite-vec`. 
    *   [ ] Initialize the databases: `sessions`, `messages`, and the `vec0` virtual table for RAG.
    *   [ ] Write the utility script that embeds conversational chunks into Pinecone/SQLite upon receipt of a new message.

---

### Stream Beta: Interface & Communication Layer
**Focus:** Connecting the LLM engine to the outside world.

*   **Phase B1: Telegram Integration (Agent 2)**
    *   [ ] Implement `telegram_handler.ts` using `node-telegram-bot-api`.
    *   [ ] Implement the "DM Pairing" protocol: unknown senders receive a pairing code instead of being silently ignored.
    *   [ ] Build the `twinclaw pairing approve telegram <code>` command to securely whitelist users based on the `dmPolicy: "pairing"` setting.
    *   [ ] Ensure incoming messages are routed reliably to the TwinClaw context window, and responses are queued back to the user.
*   **Phase B2: Voice Synthesis & Audio Processing (Agent 2)**
    *   [ ] Integrate Whisper (via Groq or OpenAI) to intercept and transcribe incoming Telegram voice notes.
    *   [ ] Integrate ElevenLabs API to allow TwinClaw to stream Text-to-Speech (TTS) voice note replies back to the user on command.
*   **Phase B3: WhatsApp Interface (Agent 2)**
    *   [ ] Deploy the Evolution API or WAHA docker container.
    *   [ ] Implement the `twinclaw channels login whatsapp` QR-code flow using the Evolution/WAHA client.
    *   [ ] Hook the WhatsApp Webhook listener into the exact same processing and pairing pipeline utilized by the Telegram handler.

---

### Stream Gamma: Proactive Orchestration & Skills
**Focus:** Making the bot proactive and giving it agency.

*   **Phase G1: Identity & Soul Deployment (Agent 3)**
    *   [ ] Create `./identity/soul.md` establishing the bot's unyielding core behavioral rules.
    *   [ ] Create `./identity/identity.md` establishing the bot's persona and context.
    *   [ ] Create `./identity/memory.md` establishing the bot's explicit long-term factual anchors.
    *   [ ] Write the context-assembly function that injects these markdown files into the `system_prompt` on every cycle.
*   **Phase G2: Background Heartbeat & Jobs (Agent 3)**
    *   [ ] Install `node-cron` or `Sidequest.js` to establish an hourly/daily heartbeat.
    *   [ ] Program the heartbeat routine: TwinClaw automatically pings the user on Telegram at 8:00 AM for daily accountability, driven entirely by cron events rather than user prompts.
*   **Phase G3: Model Context Protocol (MCP) Integration (Agent 3)**
    *   [ ] Write a base `Skill` class/parser defining `name`, `description`, `parameters`, and `execute()`.
    *   [ ] Connect the Zapier MCP Server to allow TwinClaw to silently read emails and manipulate calendars.
    *   [ ] Connect the standard GitHub and Context7 MCP servers for runtime intelligence gathering.

---

### Stream Delta: Browser Multimodality & Deployment
**Focus:** UI manipulation and persistent cloud hosting.

*   **Phase D1: Autonomous Browser Integration (Agent 4)**
    *   [ ] Install `playwright-core`.
    *   [ ] Generate server endpoints (`POST /browser/snapshot`, `POST /browser/click`) that output Accessibility Trees or Screenshots to the LLM context.
    *   [ ] Map standard LLM tool calls (like "Click Element 12") to actual Playwright executions.
*   **Phase D2: Staging Workflow & Railway Deployment (Agent 4)**
    *   [ ] Document the staging sequence: *Local Code Edit -> Local Docker Run -> Test via Telegram -> Push to Production.*
    *   [ ] Install Railway CLI and write the deployment configuration (`railway.json`).
    *   [ ] Execute the final push to the isolated Railway cloud container to achieve 24/7 uptime without local machine dependency.

---

### Stream Epsilon: Post-MVP Windows Ecosystem & Scaling
**Focus:** Native Windows integration and secure scaling.

*   **Phase E1: Windows System Integration (Agent 5)**
    *   [ ] Build the Windows Service daemon installer (`twinclaw onboard --install-daemon`) using `node-windows`.
    *   [ ] Implement PowerShell capability nodes (`system.run` expansion) and native Windows Toast notifications (`system.notify`).
*   **Phase E2: Windows System Tray Companion (Agent 6)**
    *   [ ] Develop the System Tray App using Electron/Tauri with quick-access controls and health indicators.
    *   [ ] Implement the Voice Wake/PTT GUI overlay and "Talk Mode" visual workspace.
*   **Phase E3: Extended Channels & Canvas (Agent 7)**
    *   [ ] Integrate extended messaging modules (Teams, Discord, Slack) into the core Gateway.
    *   [ ] Deploy the A2UI Canvas rendering engine for interactive agent-driven UI components.
*   **Phase E4: Tailscale Remote Access (Agent 8)**
    *   [ ] Implement the `gateway.tailscale.mode` automation script for Serve and Funnel.
    *   [ ] Write the security audit and password-auth enforcement module for public Funnel access.

---

## Agent Operational Protocol
When an AI agent is assigned to a specific Stream (e.g., Stream Alpha), it must:
1.  Read this Roadmap and the core [PRD.md](file:///d:/vs%20code/TwinBot/docs/PRD.md).
2.  Announce its designated Phase (e.g., `[Agent] Commencing Phase A1: Environment Initialization`).
3.  Execute the Phase sequentially, committing code securely.
4.  Write robust isolated unit tests for the components built.
5.  Report complete status before moving to the next Phase in the Stream.
