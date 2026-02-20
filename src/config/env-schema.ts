/**
 * Centralized registry of all environment and secret keys consumed by TwinClaw.
 *
 * Each entry declares:
 *   - `key`         The exact env variable name.
 *   - `type`        Whether the value is a sensitive secret or a plain env var.
 *   - `class`       'required' | 'optional' | 'conditional'.
 *   - `scope`       Subsystem that owns the key.
 *   - `condition`   Feature gate that makes a conditional key applicable.
 *   - `description` Human-readable purpose.
 *   - `remediation` Actionable hint when the key is missing or invalid.
 */

export type ConfigKeyClass = 'required' | 'optional' | 'conditional';

export type ConfigKeyType = 'secret' | 'env';

export type ConfigKeyScope =
  | 'runtime'
  | 'model'
  | 'messaging'
  | 'integration'
  | 'storage';

/**
 * Stable feature gate identifiers used by `condition`.
 * Format: `<subsystem>:<feature>`.
 */
export type ConfigCondition =
  | 'model:primary'
  | 'model:fallback_1'
  | 'model:fallback_2'
  | 'messaging:telegram'
  | 'messaging:whatsapp'
  | 'messaging:voice'
  | 'embedding:openai'
  | 'embedding:openai_fallback';

export interface ConfigKeySpec {
  key: string;
  type: ConfigKeyType;
  class: ConfigKeyClass;
  scope: ConfigKeyScope;
  /** Applies only when class === 'conditional'. Identifies the feature gate. */
  condition?: ConfigCondition;
  description: string;
  remediation: string;
}

/**
 * Complete inventory of environment and secret keys for TwinClaw.
 * Consumed by `EnvValidator` for startup/doctor/health diagnostics.
 */
export const CONFIG_SCHEMA: readonly ConfigKeySpec[] = [
  // ── Runtime Core ────────────────────────────────────────────────────────────
  {
    key: 'API_SECRET',
    type: 'secret',
    class: 'required',
    scope: 'runtime',
    description:
      'Master HMAC secret for webhook signature verification. Also used as the secret-vault encryption fallback when SECRET_VAULT_MASTER_KEY is unset.',
    remediation:
      "Set API_SECRET in your .env file or register it via `secret set API_SECRET <value>` before starting.",
  },
  {
    key: 'SECRET_VAULT_MASTER_KEY',
    type: 'env',
    class: 'optional',
    scope: 'runtime',
    description:
      'Dedicated AES-256 encryption key for the secret vault. Falls back to API_SECRET if unset.',
    remediation:
      'Optionally set SECRET_VAULT_MASTER_KEY for a dedicated vault encryption key independent of API_SECRET.',
  },
  {
    key: 'SECRET_VAULT_REQUIRED',
    type: 'env',
    class: 'optional',
    scope: 'runtime',
    description:
      'Comma-separated list of additional secret names that must be present at startup.',
    remediation:
      'Set SECRET_VAULT_REQUIRED to enforce presence of extra secrets, e.g. SECRET_VAULT_REQUIRED=DB_PASSWORD,SOME_TOKEN.',
  },
  {
    key: 'API_PORT',
    type: 'env',
    class: 'optional',
    scope: 'runtime',
    description: 'Listening port for the HTTP control plane API (default: 3100).',
    remediation: 'Set API_PORT to change the control plane port, e.g. API_PORT=8080.',
  },

  // ── Model Routing ────────────────────────────────────────────────────────────
  {
    key: 'MODAL_API_KEY',
    type: 'secret',
    class: 'conditional',
    condition: 'model:primary',
    scope: 'model',
    description: 'API key for the Modal-hosted primary model (GLM-5-FP8).',
    remediation:
      'Set MODAL_API_KEY to enable the primary model provider. At least one model API key is required for AI functionality.',
  },
  {
    key: 'OPENROUTER_API_KEY',
    type: 'secret',
    class: 'conditional',
    condition: 'model:fallback_1',
    scope: 'model',
    description: 'API key for the OpenRouter fallback model (stepfun/step-3.5-flash).',
    remediation:
      'Set OPENROUTER_API_KEY to enable OpenRouter as a fallback model provider.',
  },
  {
    key: 'GEMINI_API_KEY',
    type: 'secret',
    class: 'conditional',
    condition: 'model:fallback_2',
    scope: 'model',
    description: 'API key for the Google Gemini fallback model (gemini-flash-lite-latest).',
    remediation:
      'Set GEMINI_API_KEY to enable Gemini as a secondary fallback model provider.',
  },

  // ── Messaging: Telegram ──────────────────────────────────────────────────────
  {
    key: 'TELEGRAM_BOT_TOKEN',
    type: 'secret',
    class: 'conditional',
    condition: 'messaging:telegram',
    scope: 'messaging',
    description: 'Telegram Bot API token obtained from @BotFather.',
    remediation:
      'Set TELEGRAM_BOT_TOKEN to enable Telegram messaging. Create a bot at https://t.me/BotFather.',
  },
  {
    key: 'TELEGRAM_USER_ID',
    type: 'env',
    class: 'conditional',
    condition: 'messaging:telegram',
    scope: 'messaging',
    description:
      'Your personal Telegram user ID (integer). Restricts bot interactions to this user only.',
    remediation:
      'Set TELEGRAM_USER_ID to your numeric Telegram user ID. Find it by messaging @userinfobot on Telegram.',
  },

  // ── Messaging: WhatsApp ──────────────────────────────────────────────────────
  {
    key: 'WHATSAPP_PHONE_NUMBER',
    type: 'secret',
    class: 'conditional',
    condition: 'messaging:whatsapp',
    scope: 'messaging',
    description:
      'Phone number for the WhatsApp native client (whatsapp-web.js). E.164 format recommended.',
    remediation:
      'Set WHATSAPP_PHONE_NUMBER to enable WhatsApp messaging integration.',
  },

  // ── Voice / Audio (Groq) ─────────────────────────────────────────────────────
  {
    key: 'GROQ_API_KEY',
    type: 'secret',
    class: 'conditional',
    condition: 'messaging:voice',
    scope: 'messaging',
    description:
      'Groq API key for Speech-to-Text (Whisper) and Text-to-Speech (Orpheus). Required when Telegram or WhatsApp voice messaging is active.',
    remediation:
      'Set GROQ_API_KEY. A free-tier key is available at https://console.groq.com.',
  },

  // ── Embedding ────────────────────────────────────────────────────────────────
  {
    key: 'EMBEDDING_PROVIDER',
    type: 'env',
    class: 'optional',
    scope: 'integration',
    description:
      'Embedding backend: "openai" (default) or "ollama" for local-only operation.',
    remediation:
      'Set EMBEDDING_PROVIDER=ollama to use Ollama for embeddings without any API key.',
  },
  {
    key: 'EMBEDDING_API_KEY',
    type: 'secret',
    class: 'conditional',
    condition: 'embedding:openai',
    scope: 'integration',
    description:
      'API key for the OpenAI-compatible embedding endpoint. Takes priority over OPENAI_API_KEY.',
    remediation:
      'Set EMBEDDING_API_KEY (or OPENAI_API_KEY) to enable remote embedding with an OpenAI-compatible provider.',
  },
  {
    key: 'OPENAI_API_KEY',
    type: 'secret',
    class: 'conditional',
    condition: 'embedding:openai_fallback',
    scope: 'integration',
    description:
      'OpenAI API key used as a fallback for embeddings when EMBEDDING_API_KEY is unset.',
    remediation:
      'Set OPENAI_API_KEY as an alternative to EMBEDDING_API_KEY for OpenAI embedding access.',
  },
  {
    key: 'EMBEDDING_API_URL',
    type: 'env',
    class: 'optional',
    scope: 'integration',
    description: 'Custom OpenAI-compatible embedding endpoint URL (default: https://api.openai.com/v1/embeddings).',
    remediation:
      'Override EMBEDDING_API_URL to point at a self-hosted or alternative embedding API.',
  },
  {
    key: 'EMBEDDING_MODEL',
    type: 'env',
    class: 'optional',
    scope: 'integration',
    description: 'Model name used for OpenAI-compatible embeddings (default: text-embedding-3-small).',
    remediation: 'Set EMBEDDING_MODEL to use a different OpenAI-compatible embedding model.',
  },
  {
    key: 'MEMORY_EMBEDDING_DIM',
    type: 'env',
    class: 'optional',
    scope: 'storage',
    description:
      'Expected embedding vector dimensionality for sqlite-vec storage (default: 1536). Must match the chosen embedding model.',
    remediation:
      "Set MEMORY_EMBEDDING_DIM to match your embedding model's output dimensions to avoid vector shape mismatches.",
  },
  {
    key: 'OLLAMA_BASE_URL',
    type: 'env',
    class: 'optional',
    scope: 'integration',
    description: 'Base URL for a local Ollama server (default: http://localhost:11434).',
    remediation:
      'Set OLLAMA_BASE_URL if your Ollama instance runs on a non-default host or port.',
  },
  {
    key: 'OLLAMA_EMBEDDING_MODEL',
    type: 'env',
    class: 'optional',
    scope: 'integration',
    description: 'Ollama model name used for local embeddings (default: mxbai-embed-large).',
    remediation:
      'Set OLLAMA_EMBEDDING_MODEL to override the local Ollama embedding model.',
  },
] as const;

/** Quick lookup map by key name for O(1) resolution. */
export const CONFIG_SCHEMA_MAP: ReadonlyMap<string, ConfigKeySpec> = new Map(
  CONFIG_SCHEMA.map((spec) => [spec.key, spec]),
);
