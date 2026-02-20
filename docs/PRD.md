# TwinClaw Product Requirements Document (PRD)

## 1. Executive Summary
TwinClaw is a zero-cost, local-first autonomous agentic service inspired by the OpenClaw architecture. It operates as a highly privileged computational agent connecting AI models directly to desktop environments and messaging platforms. By prioritizing maximum local utility and bypassing expensive cloud infrastructure (such as LLM subscriptions, custom cloud orchestration, and paid messaging APIs), TwinClaw acts as a fully empowered local administrator capable of asynchronous background task execution, proactive file-centric behaviors, and multimodal interactions.

## 2. Core Philosophy & Constraints
- **Zero-Cost Infrastructure:** Relies exclusively on free-tier APIs (Modal Research, OpenRouter, Google AI Studio) and local models (Ollama). Avoids paid messaging platforms.
- **Local-First Capabilities:** Employs embedded datastores (SQLite) and local background workers rather than external services like Redis or cloud vector databases (e.g., ChromaDB).
- **Utility Over Security:** Embraces a "Faustian bargain" by granting the agent direct, non-sandboxed access to the host machine's root directory, standard shell commands, and applications to maximize systemic automation, omitting strict Human-In-The-Loop (HITL) blockers for most actions.
- **Proactive & Asynchronous:** Operates quietly in the background, continuously watching file systems executing scheduled cron jobs, and manipulating the browser autonomously.

## 3. Architecture & Tech Stack
- **Core Runtime:** Node.js (v20+), TypeScript (for native asynchronous event loops, static typing, and minimizing JSON parsing runtime failures).
- **Control Plane:** WebSockets (`ws`) bound to loopback `127.0.0.1:18789`, with REST API (via Express).
- **Model Router:** LiteLLM Proxy (handling provider abstraction and simple-shuffle failover routing).
- **Database & Semantic Memory:** `better-sqlite3` integrated with the `sqlite-vec` extension for C-based vector search (KNN).
- **Background Jobs:** `Sidequest.js` (SQLite-backed orchestrator) + `chokidar` (file watcher) replacing traditional cron.
- **Browser Automation:** `playwright-core`.
- **Vision Models:** Qwen2.5-VL / Llama 3.2 Vision (via local Ollama or free-tier APIs).
- **Messaging Interface:** Evolution API / WAHA (WhatsApp) and Telegram Bot API.

## 4. Core Features & Requirements

### 4.1 Gateway & Orchestration
- **WebSocket Control Plane:** Serves as the communication backbone, requiring an explicit connection handshake with an authentication token, returning system presence data and health snapshots.
- **Lane-Based Execution:** Tool calls must be executed serially within isolated lanes. The runtime must `await` the resolution and standard output of one tool before dispatching the next, preventing asynchronous race conditions and filesystem corruption.

### 4.2 Model Routing, Abstraction & Native Tool Calling
- Uses LiteLLM as a proxy interface to manage multiple models, normalizing native built-in tool calling across all supported models to avoid relying on error-prone regex extraction or unstructured JSON parsing.
- **Primary Engine:** `zai-org/GLM-5-FP8` (via Modal Research API) for superior reasoning and stable native tool-calling.
- **Secondary Engine:** `stepfun/step-3.5-flash:free` (via OpenRouter) acts as a powerful open-weights fallback.
- **Deep-Context Fallback:** `gemini-flash-lite-latest` (via Google AI Studio) for massive context processing and codebase analysis when primary pipelines exhaust their rate limits.
- **Failover Logic:** Implements `simple-shuffle` routing to handle strict free-tier limits by temporarily placing blocked providers on cooldown and seamlessly retrying with fallbacks, ensuring uninterrupted native tool-call execution.

### 4.3 Identity & State Management
TwinClaw adopts the established OpenClaw pattern of persisting the agent's identity and state locally using human-readable Markdown files, allowing users to deeply customize the agent simply by conversing with it.
- **`soul.md`**: The agent's constitution. Defines its core personality, operational tone, behavioral boundaries, and unbreakable directives. It ensures the AI remains stable across multiple contexts.
- **`identity.md`**: Defines the agent's specific persona, name, role, and situational awareness to shape its operational behavior.
- **`memory.md`**: Reserved for curated, persistent long-term facts, preferences, and crucial information that must be remembered persistently across sessions. 
- **Short-Term Transcripts**: Daily logs (`YYYY-MM-DD.md`) capture immediate context and conversation threads.
- **RAG Substrate (SQLite + sqlite-vec)**: Task summaries and memory files are vectorized using free embeddings and saved as `Float32` arrays in the `vec0` virtual table. The system performs KNN SQL `SELECT` queries to inject historical context into active prompts, granting infinite durable recall.

### 4.4 Multimodal Vision & Browser Integration
- **Deterministic Control:** Utilizes Playwright for CDP-based Browser automation operating within a designated managed Chromium profile, granting the agent full web-surfing capabilities.
- **UI State Parsing:** Rather than relying on fragile CSS selectors, the system captures Accessibility Tree snapshots mapped to numeric string IDs or role-based flat lists.
- **Zero-Cost Vision (VLM):** For opaque elements (e.g., PDFs, remote desktops, images), the system eschews traditional OCR, instead employing Vision Language Models (like Qwen2.5-VL) on pixel-perfect screenshots to extract text, understand visual layouts, and execute precise coordinates using numeric bounding box labels.

### 4.5 Proactive File-Centric Behaviors & Cron Jobs
- **Continuous Observation:** Utilizes `chokidar` to monitor configured workspace directories (e.g., `~/TwinClaw/Inbox`) for new files.
- **Agentic Cron Orchestration:** Scheduled routines and file events enqueue jobs into the local SQLite database via `Sidequest.js`, handling complex background autonomous execution without heavy dependencies like Redis.
- **Isolated Workers:** Background worker threads independent of the WebSocket event loop process queued jobs completely invisibly.

### 4.6 Remote Access & Messaging Integrations
- Implements remote interfaces via **WhatsApp** and **Telegram** to maximize accessibility from mobile devices.
- **WhatsApp:** Relies on free local-hosting wrappers (Evolution API or WAHA/Baileys) requiring the user to scan a terminal QR code, bypassing Meta's official Cloud API costs.
- **Telegram:** Leverages official bot token WebHooks or Polling natively, offering highly responsive zero-cost cross-platform messaging.
- Incorporates strict behavioral safety limits (human-like rate-limiting, avoidance of broadcast messages) to mitigate the risk of account bans on standard WhatsApp accounts.

## 5. System Schemas & API Contracts

### 5.1 Skill Definition Interface
Agent instructions and system tools are defined dynamically via Markdown files featuring YAML frontmatter.
```typescript
interface SkillFrontmatter {
  name: string;
  description: string;
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
  "command-dispatch"?: "tool" | "agent";
  "command-tool"?: string;
  metadata?: {
    os?: string;
    requires?: {
      bins?: string;
      env?: string;
    }
  }
}

interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  instructions: string; // The markdown body outlining instructions/recipes
}
```

### 5.2 LiteLLM Configuration Pattern
```yaml
model_list:
  - model_name: TwinClaw-primary
    litellm_params:
      model: openai/zai-org/GLM-5-FP8  # Modal Research OpenAI-Compatible endpoint
      api_base: https://api.us-west-2.modal.direct/v1
      api_key: os.environ/MODAL_API_KEY
      rpm: 10
  - model_name: TwinClaw-primary
    litellm_params:
      model: openrouter/stepfun/step-3.5-flash:free
      api_key: os.environ/OPENROUTER_API_KEY
      rpm: 15

router_settings:
  routing_strategy: simple-shuffle
  num_retries: 3
  fallbacks: [{"TwinClaw-primary": ["gemini/gemini-flash-lite-latest"]}]
```

### 5.3 Database Schema Blueprint
```sql
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    content TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
);

-- Utilizing sqlite-vec virtual table for high-performance embeddings
CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0(
    embedding float,
    session_id TEXT,
    fact_text TEXT
);
```

### 5.4 Internal Core API Endpoints
- `GET /health` : Returns JSON `{"status": "ok", "uptime": number, "vec_version": string}`.
- `POST /browser/snapshot` : Triggers Playwright to return an `aria-ref` mapped textual tree or annotated screenshot for VLM layout interpretation.
- `POST /browser/click` : Expected payload `{ "ref": string }`. Maps the numeric reference to the corresponding Playwright locator and dispatches a standard `.click()` event.

## 6. Execution Privileges & Security Operations
- **Core Principle:** The agent is deliberately provided access to Node's `child_process.exec` to execute raw bash commands autonomously without strict Human-in-the-Loop blocking prompts.
- **Protection Measures:** `.env` parsing must strictly rely on `dotenv-vault` to prevent API key leakage into source control. Routine Regex scrubbers must sanitize the agent's stdout before saving records to the plaintext SQLite `messages` table, ensuring API bills are not compromised even while filesystem functionality remains unrestricted.

## 7. Implementation Roadmap
1. **Phase 1: Core Infrastructure & Identity** – Initialize workspace, enforce `dotenv-vault`, and establish `soul.md` and `identity.md` architectures.
2. **Phase 2: Gateway Layer** – Build the WebSocket control plane and lane-based serial execution loop.
3. **Phase 3: Model Routing & Native Tools** – Configure local LiteLLM proxy utilizing GLM-5 and stepfun models, hooking into their native tool-calling features.
4. **Phase 4: SQLite-vec Memory** – Write schemas, the embedding processing pipeline mapping to `memory.md`, and RAG contextual integration logic.
5. **Phase 5: Multimodal Integration** – Script Playwright accessibility parsing and VLM screenshot overlay logic for autonomous web surfing.
6. **Phase 6: Proactive Messaging** – Launch localized watcher (`chokidar`), orchestrate cron background SQLite workers (`Sidequest.js`), and deploy WhatsApp/Telegram listeners.
