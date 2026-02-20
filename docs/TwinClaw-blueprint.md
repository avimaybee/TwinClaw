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
*   **Bots & Tooling:** BotFather, Maemo bot, Nanobot, User Info Bot
*   **Hosting Infrastructure:** Bluehost / Local Docker Containers

---

## 📋 The C.L.A.W.S. Framework: Execution Steps

### STEP 1: - Core Configuration & Containerization
**Concept:** Setting up an isolated, secure, and persistent environment for the agent to live in. TwinClaw must be containerized to run continuously without breaking your local machine.

*   **1.1 Environment Initialization:** Initialize a Node.js environment.
*   **1.2 AntiGravity Workspace:** Set up an AntiGravity workspace configured for multi-agent workflows.
*   **1.3 Dockerization:** Write a `Dockerfile` and `docker-compose.yml` to host the TwinClaw gateway securely.
*   **1.4 Persistent Memory:** Configure TwinClaw's native local SQLite integration for vector/keyword RAG memory (preventing the agent from "forgetting" past interactions).

> ****
> - Run `npm init -y` and install `TwinClaw-core`.
> - Implement `twinclaw setup` to automate `.env` generation (including `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `WHATSAPP_API_TOKEN`).
> - Implement `twinclaw doctor` to verify environment dependencies and SQLite/sqlite-vec readiness.
> - Create a `docker-compose.yml` that maps volume `./memory` to `/app/src/memory` to persist SQLite data.

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
*   **3.2 Advanced Bot Tooling:** Integrate `User Info Bot` for user parsing, and `Maemo bot` / `Nanobot` structures for handling specialized background tasks (like scraping or data formatting).
*   **3.3 WhatsApp Hook:** Mirror the Telegram interface logic to a WhatsApp Business API endpoint for cross-platform availability.

> ****
> - Create an `interfaces/` directory.
> - Build `telegram_handler.js` using the `node-telegram-bot-api` library.
> - Expose a unified CLI for the user to manage the agent (`twinclaw start`, `twinclaw gui`, `twinclaw doctor`).
> - Ensure all incoming messages are passed through TwinClaw's context window before generating a response.
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
The goal of this phase is to establish the fundamental application structure and connect it securely to a Telegram interface.

AI Workspace Initialization: Create a new local folder for TwinClaw. Provide your AI agent with an initialization prompt explaining the desired "open-core architecture" to set up the project scaffolding [03:32].

Create the Telegram Bot:

Open Telegram and search for BotFather [04:59].

Send the /newbot command.

Name the bot (e.g., TwinClaw_bot) and save the generated Access Token [05:20].

Procure the LLM Engine:

Go to OpenRouter (or a similar provider) to access various LLMs (like Claude Opus) [06:26].

Generate a new API Key with a predefined credit limit.

Establish Security Whitelisting:

Search for userinfobot on Telegram and send a message to get your personal Telegram User ID [07:24].

Instruct the AI agent to whitelist only this ID. This ensures the bot will ignore messages from anyone else in the world.

First Run: Feed the Telegram Token, OpenRouter API Key, and Telegram ID to your AI agent and ask it to initialize the bot. Send a test message (e.g., "What day is it?") via Telegram to verify the connection [08:22].

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

The 3-Tier Memory Architecture [17:47]:

Instruct your AI agent to build a memory system consisting of:

Core Memory: Always-on system prompt.

Conversation Buffer: Short-term recent chat history.

Semantic Long-Term Memory: Vectorized database for retrieving past facts.

Vector Database Integration (Pinecone):

Create a Pinecone account and generate an API key [18:25].

Provide the key to the AI agent. Instruct it to silently scan every conversation for facts, preferences, and deadlines, and embed them into Pinecone [19:08].

Onboarding Sequence: Ask the AI agent to program a /setup command where TwinClaw interviews you about your goals, routines, and preferences, automatically logging this into the Pinecone database [20:01].

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

Cloud Deployment (Railway):

To keep the heartbeat alive 24/7, create an account on Railway (a secure cloud deployment platform with no open ports) [30:03].

Instruct your AI agent to install the Railway CLI and deploy TwinClaw using railway up [30:50]. It will generate a browser pairing code for you to authenticate.

Development Workflow (skills.md & deployment.md):

To avoid running the bot twice (which causes duplicate messages), instruct your AI agent on a strict staging workflow [33:47].

Rule: Whenever making new changes, pause the Railway instance -> Run and test locally via a staging process -> Once perfected, push updates back to Railway and stop local hosting [33:57].