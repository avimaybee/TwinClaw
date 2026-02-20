# Initial Concept

TwinClaw is a zero-cost, local-first autonomous agentic service. It operates as a highly privileged computational agent connecting AI models directly to desktop environments and messaging platforms. The user's goal is to build this project based on the existing PRD, Blueprint, and Multi-Agent Implementation Roadmap, enhancing and structuring those documents as the project evolves.

## Product Vision
TwinClaw is a zero-cost, local-first autonomous agentic service that empowers users with a highly privileged computational assistant. It bridges the gap between powerful AI models and local desktop environments/messaging platforms, prioritizing maximum utility and systemic automation without the burden of expensive cloud subscriptions.

## Target Audience
- **Power Users & Developers:** Individuals seeking high-privilege local automation and systemic control over their workstations.
- **Privacy-Conscious Users:** Those looking for a local-first alternative to paid, cloud-dependent AI agent subscriptions.
- **Everyday Desktop Users:** Users who want to seamlessly integrate AI into their local files, browser workflows, and favorite messaging apps (WhatsApp/Telegram) through an easy-to-install graphical interface.

## Core Value Proposition
- **Zero-Cost Operation:** Leverages free-tier APIs and local models to eliminate monthly LLM costs.
- **Local-First Empowerment:** Grants the agent direct (non-sandboxed) access to the host machine for real-world systemic automation.
- **Asynchronous Autonomy:** Operates proactively in the background, managing tasks and monitoring files without constant user supervision.
- **Modular Extensibility:** Built with a "LEGO-block" architecture, allowing for the easy addition of new skills, models, and interfaces.

## Key Features
- **Intelligent Model Routing:** Multi-provider fallback (OpenRouter, Google AI Studio, Modal) to bypass rate limits and ensure 24/7 availability.
- **Multimodal Control Plane:** Support for GUI, TUI, and messaging interfaces (WhatsApp/Telegram) for flexible interaction.
- **Autonomous Browser & Vision:** Playwright-based web surfing combined with Vision Language Models (VLM) for human-like web interaction.
- **Persistent Semantic Memory:** SQLite-backed vector RAG (via `sqlite-vec`) ensuring the agent remembers facts, preferences, and history across sessions.
- **Proactive Execution:**
  - **Background Jobs:** `node-cron` (`JobScheduler` service) for centralized proactive task orchestration and heartbeat messages.
  - **File Watching:** `chokidar` for cross-platform local workspace and identity directory monitoring.
  - **Proactive Notifications:** `ProactiveNotifier` service bridging background events to outbound messaging platforms.

## Design Philosophy
- **Ease of Use:** A primary GUI ensures that installation and setup are accessible to everyone, regardless of technical background.
- **Modular & Decoupled:** Components (Models, Skills, Interfaces) are treated as swappable "LEGO blocks" to support a growing library of features.
- **Transparent State:** The agent's "soul," identity, and memory are persisted in human-readable Markdown files for easy auditing and customization.
- **TUI Core:** Maintains a high-performance terminal interface for developers and low-level system monitoring.
