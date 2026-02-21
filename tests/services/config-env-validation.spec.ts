import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { resetSecretVaultServiceForTests } from '../../src/services/secret-vault.js';
import { validateRuntimeConfig, assertRuntimeConfig } from '../../src/config/env-validator.js';
import { CONFIG_SCHEMA } from '../../src/config/env-schema.js';

// Helper: set a batch of env vars and return a cleanup function.
function withEnv(vars: Record<string, string | undefined>): () => void {
  const originals: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    originals[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  };
}

describe('CONFIG_SCHEMA', () => {
  it('contains unique key entries', () => {
    const keys = CONFIG_SCHEMA.map((s) => s.key);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('all conditional entries have a condition defined', () => {
    const missing = CONFIG_SCHEMA.filter(
      (s) => s.class === 'conditional' && !s.condition,
    );
    expect(missing).toHaveLength(0);
  });

  it('all entries have non-empty description and remediation', () => {
    for (const spec of CONFIG_SCHEMA) {
      expect(spec.description.trim(), `description for ${spec.key}`).not.toBe('');
      expect(spec.remediation.trim(), `remediation for ${spec.key}`).not.toBe('');
    }
  });
});

describe('validateRuntimeConfig', () => {
  let cleanupEnv: (() => void) | null = null;

  beforeEach(() => {
    // Reset the singleton so tests that touch process.env get a fresh read path.
    resetSecretVaultServiceForTests();
    // Clear all known config keys from the environment before each test.
    const cleared: Record<string, undefined> = {};
    for (const spec of CONFIG_SCHEMA) {
      cleared[spec.key] = undefined;
    }
    cleanupEnv = withEnv(cleared);
  });

  afterEach(() => {
    cleanupEnv?.();
    cleanupEnv = null;
    resetSecretVaultServiceForTests();
  });

  it('reports missing_required when API_SECRET is absent', () => {
    const result = validateRuntimeConfig();

    const fatal = result.fatalIssues.find((i) => i.key === 'API_SECRET');
    expect(fatal).toBeDefined();
    expect(fatal?.class).toBe('missing_required');
    expect(result.ok).toBe(false);
  });

  it('passes when API_SECRET is present in env', () => {
    const cleanup = withEnv({ API_SECRET: 'a-valid-test-secret-value' });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      expect(result.fatalIssues).toHaveLength(0);
      expect(result.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('includes API_SECRET in presentKeys when set', () => {
    const cleanup = withEnv({ API_SECRET: 'test-secret' });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      expect(result.presentKeys).toContain('API_SECRET');
    } finally {
      cleanup();
    }
  });

  it('emits missing_conditional for voice when messaging platform is set but GROQ_API_KEY is absent', () => {
    const cleanup = withEnv({
      API_SECRET: 'test-secret',
      TELEGRAM_BOT_TOKEN: 'tg-bot-token',
      TELEGRAM_USER_ID: '12345',
    });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const voiceIssue = result.issues.find(
        (i) => i.key === 'GROQ_API_KEY' && i.class === 'missing_conditional',
      );
      expect(voiceIssue).toBeDefined();
      expect(voiceIssue?.remediation).toContain('GROQ_API_KEY');
    } finally {
      cleanup();
    }
  });

  it('does not require TELEGRAM_USER_ID when TELEGRAM_BOT_TOKEN is configured', () => {
    const cleanup = withEnv({
      API_SECRET: 'test-secret',
      TELEGRAM_BOT_TOKEN: 'tg-bot-token',
    });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const telegramUserIssue = result.issues.find((i) => i.key === 'TELEGRAM_USER_ID');
      expect(telegramUserIssue).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('does NOT emit voice issue when messaging platform is absent', () => {
    const cleanup = withEnv({ API_SECRET: 'test-secret' });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const voiceIssue = result.issues.find((i) => i.key === 'GROQ_API_KEY');
      expect(voiceIssue).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('emits exactly one model issue when no model key is configured', () => {
    const cleanup = withEnv({ API_SECRET: 'test-secret' });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const modelIssues = result.issues.filter(
        (i) =>
          i.key === 'MODAL_API_KEY' ||
          i.key === 'OPENROUTER_API_KEY' ||
          i.key === 'GEMINI_API_KEY',
      );
      expect(modelIssues.length).toBe(1);
      expect(modelIssues[0]!.class).toBe('missing_conditional');
    } finally {
      cleanup();
    }
  });

  it('emits no model issue when at least one model key is present', () => {
    const cleanup = withEnv({
      API_SECRET: 'test-secret',
      OPENROUTER_API_KEY: 'openrouter-key',
    });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const modelIssues = result.issues.filter(
        (i) =>
          i.key === 'MODAL_API_KEY' ||
          i.key === 'OPENROUTER_API_KEY' ||
          i.key === 'GEMINI_API_KEY',
      );
      expect(modelIssues).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('reports format_error for invalid TELEGRAM_USER_ID', () => {
    const cleanup = withEnv({
      API_SECRET: 'test-secret',
      TELEGRAM_BOT_TOKEN: 'tg-bot-token',
      TELEGRAM_USER_ID: 'not-a-number',
    });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const formatIssue = result.issues.find(
        (i) => i.key === 'TELEGRAM_USER_ID' && i.class === 'format_error',
      );
      expect(formatIssue).toBeDefined();
      expect(result.ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('reports format_error for out-of-range API_PORT', () => {
    const cleanup = withEnv({
      API_SECRET: 'test-secret',
      API_PORT: '99999',
    });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const portIssue = result.issues.find(
        (i) => i.key === 'API_PORT' && i.class === 'format_error',
      );
      expect(portIssue).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it('reports format_error for invalid EMBEDDING_PROVIDER value', () => {
    const cleanup = withEnv({
      API_SECRET: 'test-secret',
      EMBEDDING_PROVIDER: 'huggingface',
    });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const embeddingIssue = result.issues.find(
        (i) => i.key === 'EMBEDDING_PROVIDER' && i.class === 'format_error',
      );
      expect(embeddingIssue).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it('does not include secret values in any issue message or remediation', () => {
    const secretValue = 'super-sensitive-api-secret-xyz987';
    const cleanup = withEnv({ API_SECRET: secretValue });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      const allText = [
        ...result.issues.map((i) => i.message + i.remediation),
        ...result.presentKeys,
        ...result.activeFeatures,
      ].join(' ');
      expect(allText).not.toContain(secretValue);
    } finally {
      cleanup();
    }
  });

  it('detects active features from present conditional keys', () => {
    const cleanup = withEnv({
      API_SECRET: 'test-secret',
      TELEGRAM_BOT_TOKEN: 'tg-token',
      TELEGRAM_USER_ID: '12345',
      GROQ_API_KEY: 'groq-key',
    });
    resetSecretVaultServiceForTests();

    try {
      const result = validateRuntimeConfig();
      expect(result.activeFeatures).toContain('messaging:telegram');
      expect(result.activeFeatures).toContain('messaging:voice');
    } finally {
      cleanup();
    }
  });

  it('validatedAt is a valid ISO-8601 string', () => {
    const cleanup = withEnv({ API_SECRET: 'test-secret' });
    resetSecretVaultServiceForTests();

    try {
      const fixedDate = new Date('2026-02-20T12:00:00.000Z');
      const result = validateRuntimeConfig(() => fixedDate);
      expect(result.validatedAt).toBe('2026-02-20T12:00:00.000Z');
    } finally {
      cleanup();
    }
  });
});

describe('assertRuntimeConfig', () => {
  beforeEach(() => {
    resetSecretVaultServiceForTests();
    const cleared: Record<string, undefined> = {};
    for (const spec of CONFIG_SCHEMA) {
      cleared[spec.key] = undefined;
    }
    withEnv(cleared);
  });

  afterEach(() => {
    resetSecretVaultServiceForTests();
  });

  it('throws with a redaction-safe message when API_SECRET is missing', () => {
    const cleanup = withEnv({
      ...Object.fromEntries(CONFIG_SCHEMA.map((s) => [s.key, undefined])),
    });
    resetSecretVaultServiceForTests();

    try {
      expect(() => assertRuntimeConfig()).toThrow(/Runtime config validation failed/i);
      expect(() => assertRuntimeConfig()).toThrow(/API_SECRET/i);
    } finally {
      cleanup();
    }
  });

  it('returns the full result when no fatal issues exist', () => {
    const cleanup = withEnv({ API_SECRET: 'a-valid-secret-value' });
    resetSecretVaultServiceForTests();

    try {
      const result = assertRuntimeConfig();
      expect(result.fatalIssues).toHaveLength(0);
      expect(result.validatedAt).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
