# 🤖 TwinClaw Project: AI Agent Implementation Blueprint

> **System Name:** TwinClaw
> **Inspiration:** GravityClaw (Jack Roberts Architecture)
> **Objective:** To build an "unstoppable", highly autonomous AI agent application that avoids rate limits, manages its own RAG memory, and interacts across multiple communication vectors.
> **Methodology:** The 5-Step C.L.A.W.S. Framework.

## 🛠️ Global Tech Stack & Dependencies
*   **Orchestration & IDE:**(https://antigravity.go)
*   **Agent Runtime:**(https://openclaw.ai/)
*   **Core Environment:** Node.js (v22+), Docker
*   **LLM Routing:** OpenRouter (Claude 4.6, GPT-5.3, Grok)
*   **Voice/Audio:** ElevenLabs, Glaido (Agentic Voice)
*   **Interfaces:** Telegram API, WhatsApp API
*   **Bots & Tooling:** BotFather, TwinClaw CLI (`onboard`, `doctor`, `pairing`), specialized sub-agents.
*   **Hosting Infrastructure:** Bluehost / Local Docker Containers

---

## 📋 The C.L.A.W.S. Framework: Execution Steps

### STEP 1: - Core Configuration & Containerization
**Concept:** Setting up an isolated, secure, and persistent environment for the agent to live in. TwinClaw must be containerized to run continuously without breaking your local machine.

*   **1.1 Environment Initialization:** Initialize a Node.js environment.
*   **1.2 AntiGravity Workspace:** Set up an AntiGravity workspace configured for multi-agent workflows.
*   **1.3 Dockerization:** Write a `Dockerfile` and `docker-compose.yml` to host the TwinClaw gateway securely.
*   **1.4 Persistent Configuration:** Implement the `%USERPROFILE%\.twinclaw\workspace\twinclaw.json` schema to store all secrets and settings, replacing `.env`. Supports profile isolation via `TWINCLAW_PROFILE` environment variable.

> **Implementation Notes:**
> - Run `npm init -y` and install `TwinClaw-core`.
> - Implement `twinclaw onboard` as the interactive entry point to collect API keys, configure model preferences, and generate the `twinclaw.json` bootstrap.
> - Implement `twinclaw doctor` to verify system dependencies, configuration health, and SQLite/sqlite-vec readiness.
> - Create a `docker-compose.yml` that maps volume `./memory` to `/app/src/memory` to persist SQLite data and configuration.

### STEP 2: - LLM Routing & Voice Integration
**Concept:** Making the agent "unstoppable" by ensuring it never hits a rate limit or goes down. This is achieved by abstracting the AI model layer.

*   **2.1 OpenRouter Setup:** Instead of hardcoding OpenAI or Anthropic SDKs, route all AI logic through OpenRouter. This allows TwinClaw to seamlessly fallback between Claude 4.6, GPT-5.3, and Grok if one model is overloaded.
*   **2.2 Voice Synthesis:** Integrate ElevenLabs and Glaido for Agentic Voice, allowing TwinClaw to process audio inputs and generate spoken responses.
*   **2.3 System Prompts:** Define the master persona and operational constraints for TwinClaw.

> ****
> - Implement an LLM routing utility class that accepts an array of preferred models (e.g., ``).
> - Write error-handling logic: If status `429 (Too Many Requests)` is returned, automatically retry with the next model in the array.
> - Integrate the ElevenLabs API for text-to-speech outputs in the response cycle.

### STEP 3: - Agentic Architecture & Interfaces
**Concept:** Giving TwinClaw eyes, ears, and hands in the real world by connecting it to messaging platforms.

*   **3.1 Telegram Integration:** Use `BotFather` to register the TwinClaw bot. Implement webhooks to receive user messages in real-time.
*   **3.2 Advanced Pairing & Task Routing:** Implement the pairing challenge for secure identity verification and utilize specialized sub-agent lanes for handling background tasks (like scraping or data formatting).
*   **3.3 WhatsApp Hook:** Mirror the Telegram interface logic to a WhatsApp Business API endpoint for cross-platform availability.

> **Implementation Notes:**
> - Create an `interfaces/` directory.
> - Build `telegram_handler.js` using the `node-telegram-bot-api` library.
> - Implement `dmPolicy: "pairing"` logic: unknown senders receive a pairing code and must be approved via `twinclaw pairing approve telegram <code>`.
> - Start the runtime via `twinclaw start`.
> - Run `twinclaw channels login` to link accounts via QR terminal scan (Baileys/Evolution API).
> - Ensure all incoming messages are passed through TwinClaw’s context window before generating a response.
> - Map audio messages received on Telegram to a Whisper/Glaido transcription pipeline before processing.

### STEP 4: - Workflows & Web Hooks
**Concept:** Moving beyond a "chatbot" into an autonomous worker. TwinClaw must be able to execute multi-step plans without the user holding its hand.

*   **4.1 TwinClaw Gateway:** Deploy the TwinClaw Gateway so the agent can manage its own internal API states.
*   **4.2 Multi-Agent Orchestration:** Use AntiGravity's Agent Manager to spawn sub-agents. (e.g., If a user asks TwinClaw to research a topic, TwinClaw spawns a sub-agent to browse the web while TwinClaw continues chatting with the user).
*   **4.3 State Management:** Log all workflow steps locally.

> ****
> - Implement TwinClaw's `buildToolStreamMessage` function to allow the agent to execute functions sequentially.
> - Write a Webhook listener in Express.js that can receive callbacks from external APIs when long-running background tasks (like web scraping) are complete.

### STEP 5: - Skills Ecosystem
**Concept:** "Skills" are what make an TwinClaw agent useful. They are encapsulated, repeatable code blocks that the agent can trigger at will. 

*   **5.1 Skill Registration:** Give TwinClaw access to the local file system, web search APIs, and database querying tools.
*   **5.2 Custom Skill Creation:** Build bespoke skills for TwinClaw (e.g., a "Create Invoice" skill, a "Post to Twitter" skill).
*   **5.3 Self-Healing Logic:** Allow TwinClaw to use Claude 4.6 to write its *own* skills if it encounters a task it doesn't currently know how to do, saving it to its `skills/` directory for future use.

> ****
> - Create a `skills/` folder.
> - Implement the Model Context Protocol (MCP) to standardize how TwinClaw interacts with these skills.
> - Write a base `Skill` class that requires a `name`, `description`, `parameters`, and an `execute()` function.
> - Register a default `web_search` skill and a `read_memory` skill.

---

### STEP 6: - Post-MVP Windows Integrations & Expansion
**Concept:** Deepening the agent's integration into the Windows ecosystem and providing secure remote access.

*   **6.1 Windows Daemon & Onboarding:** Implement a terminal-based onboarding wizard that installs TwinClaw as a permanent Windows Service.
*   **6.2 Windows Tray App:** Create a lightweight companion application for the Windows taskbar with Voice Wake and Talk Mode overlays.
*   **6.3 Tailscale Remote Access:** Automate Tailscale Serve/Funnel setup for secure, zero-config remote dashboard access.
*   **6.4 Extended Multi-Channel Reach:** Connect the Gateway to Microsoft Teams, Discord, and Slack via dedicated bridge modules.

> **Implementation Notes:**
> - Build the `twinclaw onboard --install-daemon` command using a Windows Service wrapper (e.g., `node-windows`).
> - Use Electron or Tauri to build the persistent System Tray GUI.
> - Integrate with Tailscale CLI to manage port forwarding and funnel status.
> - Deploy the A2UI Canvas engine for visually rich agent-driven interfaces.

---

## 🚀 Execution Initiation Command
**For the AI Agent:** Begin by reading the `` block. Acknowledge this document, confirm your understanding of the C.L.A.W.S. framework, and output the first terminal commands required to initialize the `TwinClaw` repository.


## natural language explanation
🦅 TwinClaw Architecture & Implementation Guide
Based on the GravityClaw Framework

This document serves as the master instruction manual for an AI agent (like Anti-Gravity, Claude, Cursor, or Devin) to build "TwinClaw"—a fully customized, local-first, proactive AI assistant.

🛠 Prerequisites & Environment Setup
Before beginning the framework, ensure the host machine has the following installed:

Docker: For safe containerization of the application environment [04:33].

Node.js: Core runtime for the bot [04:38].

Telegram Desktop: Used as the primary frontend UI for communicating with TwinClaw [04:17].

Step 1: Connect (Core Scaffolding & Bot Initialization)
The goal of this phase is to establish the fundamental application structure and connect it securely to a Telegram interface without messing with environment files.

AI Workspace Initialization: Create a new local folder for TwinClaw. Provide your AI agent with an initialization prompt explaining the desired "open-core architecture" to set up the project scaffolding [03:32].

CLI Onboarding: Run the `twinclaw onboard` command. This interactive wizard will walk you through setting up your workspace and entering your API keys (OpenRouter, ElevenLabs, etc.), saving them securely to a local file instead of a `.env` [03:32].

Create the Telegram Bot:
1. Open Telegram and search for BotFather [04:59].
2. Send the /newbot command.
3. Save the token and enter it when prompted by the onboarding wizard.

Establish Security via Pairing:
1. Start the gateway (`twinclaw start`).
2. Send a message to your bot.
3. The bot will reply with a pairing code.
4. Run `twinclaw pairing approve telegram <code>` in your terminal to whitelist yourself. This replaces the manual ID whitelisting process.

First Run: Once onboarded and paired, send a test message (e.g., "What day is it?") via Telegram to verify the connection [08:22].

Step 2: Listen (Voice & Audio Processing)
The goal of this phase is to give TwinClaw the ability to transcribe user voice notes and reply with high-quality Text-to-Speech (TTS).

Voice Transcription (Whisper):

Create a free account at console.groq.com (or use an OpenAI API key) to access fast Whisper transcriptions [11:16].

Generate an API Key and provide it to the AI agent, instructing it to intercept Telegram voice messages, transcribe them, and process the text as standard input [11:38].

Voice Synthesis (ElevenLabs):

Create an account on ElevenLabs to give TwinClaw a realistic voice [12:49].

Navigate to Developer -> API Keys and generate a key [13:29].

Instruct your AI agent to integrate the ElevenLabs API so TwinClaw can dynamically respond with voice messages when requested. You can customize the voice (e.g., "UK British male") via natural language prompts [15:31].

Step 3: Archive (Superhuman Memory System)
The goal of this phase is to prevent context-window bloat while ensuring TwinClaw never forgets a detail across infinite restarts.

### Tiered Local Memory System:
Instruct your AI agent to build a memory system consisting of:
1. **Core Memory:** Always-on system prompt (`soul.md`).
2. **Short-Term Context:** Conversation buffer stored in the local messages table.
3. **Semantic Long-Term Memory:** Local `better-sqlite3` database utilizing the `sqlite-vec` extension for high-performance vector retrieval.

Local Vector Search Integration (`sqlite-vec`):
1. Configure the AI agent to use free embeddings (e.g., from Google AI Studio or local Ollama) to vectorize memories.
2. Instruct it to silently scan every conversation for facts, preferences, and deadlines, and embed them into the local `vec_memory` table.
3. **Onboarding Sequence:** Ask the AI agent to program a `/setup` command where TwinClaw interviews you about your goals, routines, and preferences, automatically logging this into the local database for infinite recall.

The soul.md File: Create a specific markdown file that acts as the bot's permanent personality compass. Define exactly how TwinClaw should behave (e.g., casual, constructive, challenging your ideas, not sycophantic) [21:16].

Step 4: Wire (Tool Calling via MCP)
The goal of this phase is to give TwinClaw "superpowers" to control your actual digital life and software using the Model Context Protocol (MCP).

Integrate MCP Servers: Find open-source MCP configurations (e.g., GitHub, Context 7, Playwright) [23:29].

Add to mcp_config: * Copy the raw MCP configuration code and instruct your AI agent to add it to your local MCP configuration file [24:04].

Zapier Integration: Specifically, integrate the Zapier MCP. This allows TwinClaw to securely read your Gmail, check your calendar, or post on your behalf, entirely managed locally [23:04].

Verification: Test the wiring by asking TwinClaw via Telegram to read you the subject line of the last email you received [26:21].

Step 5: Sense (Heartbeat & Remote Deployment)
The goal of this phase is to make TwinClaw proactive so it messages you first, and to host it in the cloud so it runs when your laptop is closed.

Establish a Heartbeat (Node Cron):

Instruct the AI agent to install a Cron job (e.g., node-cron) to act as a "heartbeat" [28:55].

Prompt the agent: "Set up a system where TwinClaw reaches out to me every day at 8 AM. It should load context and ask me for accountability on my daily goals and weight tracking." [28:05]

### Deployment & Persistence:
TwinClaw is designed to run on your local hardware. To ensure it stays active 24/7:
1. **Local Daemon:** Run `twinclaw onboard --install-daemon` to install the agent as a background service on your host OS.
2. **Health Monitoring:** Use `twinclaw doctor` to regularly check that the WebSocket control plane and channel connections remain healthy.

Development Workflow (skills.md & deployment.md):

To avoid running the bot twice (which causes duplicate messages), instruct your AI agent on a strict staging workflow [33:47].

**Rule:** Whenever making new changes, stop the local background service -> Run and test via the staging process (`twinclaw start`) -> Once perfected, restart the local service daemon.

Step 6: Windows Native (Windows Daemon & System Tray)
The goal of this phase is to turn TwinClaw into a core Windows utility that is always-on and easily accessible from the taskbar.

Establish the Windows Daemon:
- Instruct the agent to build the `twinclaw onboard --install-daemon` command.
- It should install TwinClaw as a Windows Service (`node-windows`) so it starts automatically with the PC and runs in the background.

Windows Tray Companion:
- Create a lightweight System Tray App (using Electron or Tauri) to house the control plane.
- Implement Voice Wake ("Hey TwinClaw") and a floating "Talk Mode" overlay for Windows.

Remote Access (Tailscale):
- Configure `gateway.tailscale.mode` to automate Tailscale Serve/Funnel.
- This allows secure, authenticated access to the TwinClaw dashboard from anywhere without opening firewall ports.

Canvas Expansion:
- Enable the A2UI Canvas engine for rendering interactive code blocks, diagrams, and dashboards directly in the overlay or web UI.
