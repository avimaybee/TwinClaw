import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scrubSensitiveText } from '../../src/utils/logger.js';

describe('scrubSensitiveText', () => {
  const envName = 'OPENROUTER_API_KEY';
  let previousEnvValue: string | undefined;

  beforeEach(() => {
    previousEnvValue = process.env[envName];
    process.env[envName] = 'env-secret-leak-value-123456789';
  });

  afterEach(() => {
    if (previousEnvValue === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = previousEnvValue;
    }
  });

  it('redacts raw sensitive values even when they appear outside key=value patterns', () => {
    const raw = `diagnostic trace => ${process.env[envName]} <= should be hidden`;
    const scrubbed = scrubSensitiveText(raw);

    expect(scrubbed).toContain('[REDACTED]');
    expect(scrubbed).not.toContain(process.env[envName] as string);
  });
});
