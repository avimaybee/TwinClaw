# 🦅 TwinClaw

**Native Agentic Gateway | Multi-Modal Hooks | Proactive Memory**

TwinClaw is a highly autonomous local-first AI agent designed for power users who want an "unstoppable" personal assistant that navigates between multiple LLMs, messaging platforms (Telegram/WhatsApp), and its own persistent RAG memory.

---

## ⚡ Quick Start (Windows Only)

To install and run TwinClaw with a single command, run the following in your terminal:

### **Windows (PowerShell)**
```powershell
iwr -useb bit.ly/twinclaw-install | iex
```
*(If you have cloned the repository, simply run `.\bootstrap.ps1`)*

---

## 🛠 Features

- **Double-Layered Intelligence**: Native model routing through **OpenRouter**, **Gemini**, and **Modal** with automatic 429 retries and fallbacks.
- **Voice-First**: Seamless integration with **ElevenLabs** (Text-to-Speech) and **Groq** (Speech-to-Text).
- **Ubiquitous Access**: Control your agent or receive proactive notifications via **Telegram** and **WhatsApp**.
- **Agentic Skills**: Extensible Skill system (MCP-compatible) allowing the agent to read files, search the web, and manage its own memory.
- **Local Persistence**: Zero-cloud knowledge graph and memory storage using **SQLite** with **sqlite-vec**.

---

## 📖 Guided Setup

When you first run TwinClaw, it will automatically start a **Guided Setup Wizard**. You don't need to manually create any `.env` files. The wizard will prompt you for:

1.  **API Keys**: Groq, OpenRouter, Gemini, ElevenLabs.
2.  **Messaging**: Telegram Bot Token and optional bootstrap allowlist IDs.
3.  **Security**: Generates a master encryption key for your local vault.
4.  **Skills**: Auto-registers built-in skills for immediate use.

TwinClaw now defaults to `dmPolicy: "pairing"` for Telegram/WhatsApp DMs. Unknown senders receive a pairing code and must be explicitly approved:

```powershell
node src/index.ts pairing list telegram
node src/index.ts pairing approve telegram <CODE>
```

---

## 🏗 Developer Architecture

TwinClaw is built with:
- **Runtime**: Node.js (v22+)
- **ORCH**: AntiGravity / OpenClaw-inspired
- **Database**: SQLite (Vector-ready)
- **Framework**: TypeScript (ESM)

For detailed technical specifications, see [docs/TwinClaw-blueprint.md](docs/TwinClaw-blueprint.md).

Operational runbooks:
- [MVP Release Checklist](docs/mvp-release-checklist.md)
- [Release & Rollback Runbook](docs/release-rollback-runbook.md)
- [Credential Rotation Runbook](docs/rotation-runbook.md)

---

## License
ISC
