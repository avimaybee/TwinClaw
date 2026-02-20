/**
 * Unified runtime configuration validator.
 *
 * Produces structured, redaction-safe diagnostics for:
 *   - Missing required config keys.
 *   - Active features whose conditional keys are absent.
 *   - Format/type violations on plain env vars.
 *   - A machine-readable summary suitable for API responses and operator tooling.
 *
 * No secret values are ever included in the output.
 */

import { CONFIG_SCHEMA } from './env-schema.js';
import type { ConfigKeySpec } from './env-schema.js';
import { getSecretVaultService } from '../services/secret-vault.js';

// ── Public types ──────────────────────────────────────────────────────────────

export type ConfigIssueClass = 'missing_required' | 'missing_conditional' | 'format_error';

export interface ConfigIssue {
  /** Affected config key. */
  key: string;
  /** Semantic category for automation. */
  class: ConfigIssueClass;
  /** Human-readable description of the problem. */
  message: string;
  /** Actionable remediation hint (no secret values). */
  remediation: string;
}

export interface ConfigValidationResult {
  /** true when the runtime is configured well enough to operate. */
  ok: boolean;
  /** Keys in a healthy state. */
  presentKeys: string[];
  /** Structured issues — guaranteed not to contain secret values. */
  issues: ConfigIssue[];
  /** Activated feature gates detected from present conditional keys. */
  activeFeatures: string[];
  /** Subset of issues that prevent startup (class === 'missing_required'). */
  fatalIssues: ConfigIssue[];
  /** ISO-8601 timestamp of validation run. */
  validatedAt: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve a config key's value without leaking it.
 * Returns true when a non-empty value exists (vault → env), false otherwise.
 */
function hasValue(spec: ConfigKeySpec): boolean {
  if (spec.type === 'secret') {
    return getSecretVaultService().readSecret(spec.key) !== null;
  }
  const raw = process.env[spec.key];
  return typeof raw === 'string' && raw.trim().length > 0;
}

/**
 * Validate additional format constraints for known env vars.
 * Returns an issue string if invalid, null if ok.
 */
function formatError(spec: ConfigKeySpec): string | null {
  if (spec.type !== 'env') {
    return null;
  }

  const raw = process.env[spec.key];
  if (!raw) {
    return null; // missing handled separately
  }

  switch (spec.key) {
    case 'TELEGRAM_USER_ID': {
      const parsed = Number(raw.trim());
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return `TELEGRAM_USER_ID must be a positive integer, got '${raw.trim()}'.`;
      }
      break;
    }
    case 'MEMORY_EMBEDDING_DIM': {
      const parsed = Number(raw.trim());
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
        return `MEMORY_EMBEDDING_DIM must be a positive integer, got '${raw.trim()}'.`;
      }
      break;
    }
    case 'API_PORT': {
      const parsed = Number(raw.trim());
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return `API_PORT must be an integer in range 1–65535, got '${raw.trim()}'.`;
      }
      break;
    }
    case 'EMBEDDING_PROVIDER': {
      const v = raw.trim().toLowerCase();
      if (v !== 'openai' && v !== 'ollama') {
        return `EMBEDDING_PROVIDER must be 'openai' or 'ollama', got '${raw.trim()}'.`;
      }
      break;
    }
    default:
      break;
  }

  return null;
}

/**
 * Detect which feature gates are currently active based on present keys.
 *
 * A feature gate is considered "active" if its paired conditional key is present.
 */
function detectActiveFeatures(): Set<string> {
  const active = new Set<string>();

  for (const spec of CONFIG_SCHEMA) {
    if (spec.class !== 'conditional' || !spec.condition) {
      continue;
    }
    if (hasValue(spec)) {
      active.add(spec.condition);
    }
  }

  return active;
}

/**
 * Resolve the model feature gates that are active.
 *
 * The model subsystem is considered "active" when at least one model API key is present.
 * Individual model conditions only generate issues when no model key is available at all.
 */
function hasAnyModelKey(): boolean {
  const modelKeys = ['MODAL_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY'];
  return modelKeys.some((key) => getSecretVaultService().readSecret(key) !== null);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate the runtime configuration against the schema.
 *
 * @param now - Injectable clock (ISO-8601 source). Defaults to `new Date()`.
 */
export function validateRuntimeConfig(
  now: () => Date = () => new Date(),
): ConfigValidationResult {
  const issues: ConfigIssue[] = [];
  const presentKeys: string[] = [];
  const activeFeatures = detectActiveFeatures();
  const anyModelKey = hasAnyModelKey();

  for (const spec of CONFIG_SCHEMA) {
    const present = hasValue(spec);

    if (present) {
      presentKeys.push(spec.key);
    }

    // ── Format validation (even for present keys) ───────────────────────────
    const formatErr = formatError(spec);
    if (formatErr) {
      issues.push({
        key: spec.key,
        class: 'format_error',
        message: formatErr,
        remediation: spec.remediation,
      });
      continue;
    }

    if (present) {
      continue; // value is present and valid
    }

    // ── Missing key handling ────────────────────────────────────────────────
    switch (spec.class) {
      case 'required':
        issues.push({
          key: spec.key,
          class: 'missing_required',
          message: `Required config key '${spec.key}' is missing. ${spec.description}`,
          remediation: spec.remediation,
        });
        break;

      case 'conditional': {
        // Model keys: only flag as an issue when no model key is configured at all.
        if (
          spec.condition === 'model:primary' ||
          spec.condition === 'model:fallback_1' ||
          spec.condition === 'model:fallback_2'
        ) {
          if (!anyModelKey) {
            // Only emit this issue once (for the first model key that is checked).
            // Deduplicate by checking if a model issue was already emitted.
            const alreadyReported = issues.some(
              (i) =>
                i.key === 'MODAL_API_KEY' ||
                i.key === 'OPENROUTER_API_KEY' ||
                i.key === 'GEMINI_API_KEY',
            );
            if (!alreadyReported) {
              issues.push({
                key: spec.key,
                class: 'missing_conditional',
                message:
                  `No model API key is configured (MODAL_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY). ` +
                  `At least one is required for AI functionality.`,
                remediation: spec.remediation,
              });
            }
          }
          break;
        }

        // Telegram: both parts must be set together.
        if (
          spec.condition === 'messaging:telegram' &&
          activeFeatures.has('messaging:telegram')
        ) {
          issues.push({
            key: spec.key,
            class: 'missing_conditional',
            message: `Telegram integration is partially configured — '${spec.key}' is missing. ${spec.description}`,
            remediation: spec.remediation,
          });
          break;
        }

        // Voice: flag if any messaging platform is active but GROQ_API_KEY is absent.
        if (spec.condition === 'messaging:voice') {
          const messagingActive =
            activeFeatures.has('messaging:telegram') ||
            activeFeatures.has('messaging:whatsapp');

          if (messagingActive) {
            issues.push({
              key: spec.key,
              class: 'missing_conditional',
              message:
                `GROQ_API_KEY is required for voice messaging but is not configured. ` +
                `Messaging dispatcher will start in text-only mode.`,
              remediation: spec.remediation,
            });
          }
          break;
        }

        // All other conditional keys: only flag when both parts of a pair are partially set.
        // Otherwise, silently skip (feature is simply not enabled).
        break;
      }

      case 'optional':
        // Optional keys are never surfaced as issues when absent.
        break;
    }
  }

  const fatalIssues = issues.filter((i) => i.class === 'missing_required');

  return {
    ok: fatalIssues.length === 0 && !issues.some((i) => i.class === 'format_error'),
    presentKeys: presentKeys.sort(),
    issues,
    activeFeatures: [...activeFeatures].sort(),
    fatalIssues,
    validatedAt: now().toISOString(),
  };
}

/**
 * Run the runtime config validation and throw when fatal issues exist.
 *
 * Safe to call during startup. Never exposes secret values in the thrown error.
 *
 * @returns The full `ConfigValidationResult` when validation passes.
 * @throws Error with actionable, redaction-safe message when fatal issues are found.
 */
export function assertRuntimeConfig(
  now: () => Date = () => new Date(),
): ConfigValidationResult {
  const result = validateRuntimeConfig(now);

  if (result.fatalIssues.length > 0) {
    const reasons = result.fatalIssues.map((i) => i.message).join(' | ');
    throw new Error(`Runtime config validation failed: ${reasons}`);
  }

  return result;
}
