# Technology Stack: TwinClaw

## Core Runtime & Infrastructure
- **Runtime:** Node.js (v22+) with TypeScript (ES2022) for robust asynchronous execution.
- **Containerization:** Docker & Docker Compose for isolated, persistent environments.
- **Deployment:** Railway (Cloud Hosting) for 24/7 proactive "heartbeat" operations.
- **Local Workspace:** AntiGravity Workspace for multi-agent workflow orchestration.

## AI & Model Layer
- **LLM Routing:** OpenRouter (Primary: Claude, GPT-4, Grok) with automated failover and rate-limit handling.
- **Model Orchestration:** LiteLLM Proxy / OpenClaw Core for standardized tool calling and provider abstraction.
- **Voice & Audio:** ElevenLabs (TTS) and Groq/Whisper (STT) for agentic voice interactions.
- **Intelligence Protocol:** Model Context Protocol (MCP) for standardized skill integration.

## Memory & Data Substrate
- **Primary Database:** SQLite (`better-sqlite3`) for local message persistence, session management, and embedded vector search operations.
- **Semantic Memory:** `sqlite-vec` (`vec0`) for vectorized long-term factual RAG (Retrieval-Augmented Generation), fully local and serverless.
- **Embeddings:** Configurable local (`Ollama` `mxbai-embed-large`) or remote OpenAI-compatible embedding providers.
- **State Files:** Human-readable Markdown (`soul.md`, `identity.md`, `user.md`) for personality and user-preference persistence.

## Interfaces & Communication
- **GUI:** Electron/React-based graphical interface for easy installation and setup.
- **TUI:** Native Terminal User Interface for low-level system monitoring and developer access.
- **Messaging:** Telegram Bot API and WhatsApp (Evolution API / WAHA) for remote interaction.

## Automation & Agency
- **Browser Automation:** Playwright for headless/headed web surfing and UI interaction.
- **Background Jobs:** `node-cron` (`JobScheduler` service) for centralized proactive task orchestration and heartbeat messages.
- **File Watching:** `chokidar` for cross-platform local workspace and identity directory monitoring.
- **Proactive Notifications:** `ProactiveNotifier` service bridging background events to outbound messaging platforms.
- **System Access:** Node.js `child_process` for raw (non-sandboxed) local shell and filesystem execution.
