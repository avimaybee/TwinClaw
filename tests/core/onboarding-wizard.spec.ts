import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  runSetupWizard,
  type SetupPrompter,
} from '../../src/core/onboarding.js';

class MockPrompter implements SetupPrompter {
  answers: string[];
  currentIdx = 0;
  questions: string[] = [];

  constructor(answers: string[]) {
    this.answers = answers;
  }

  async prompt(question: string): Promise<string> {
    this.questions.push(question);
    const answer = this.answers[this.currentIdx++];
    if (answer === undefined) {
      return '';
    }
    return answer;
  }

  close(): void {}
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('Onboarding Wizard UX 2.0', () => {
  let tempDir = '';
  let configPath = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-wizard-'));
    configPath = path.join(tempDir, 'twinclaw.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('completes the full wizard flow with summary confirmation', async () => {
    const answers = [
      'top-secret-api', // API_SECRET
      '3100',           // API_PORT
      'openrouter-key', // OPENROUTER_API_KEY
      '',               // MODAL_API_KEY
      '',               // GEMINI_API_KEY
      '',               // GROQ_API_KEY
      '',               // TELEGRAM_BOT_TOKEN
      '',               // TELEGRAM_USER_ID
      '',               // WHATSAPP_PHONE_NUMBER
      'openai',         // EMBEDDING_PROVIDER
      'y'               // Summary Confirmation
    ];

    const prompter = new MockPrompter(answers);
    const result = await runSetupWizard({
      configPathOverride: configPath,
      prompter,
    });

    expect(result.status).toBe('success');
    const config = await readJson(configPath);
    expect((config['runtime'] as any)['apiSecret']).toBe('top-secret-api');
    expect((config['models'] as any)['openRouterApiKey']).toBe('openrouter-key');
  });

  it('enforces at least one model key during the models section', async () => {
    const answers = [
      'top-secret', // API_SECRET
      '3100',       // API_PORT
      '',           // OPENROUTER_API_KEY (empty)
      '',           // MODAL_API_KEY (empty)
      '',           // GEMINI_API_KEY (empty)
      '',           // GROQ_API_KEY (empty)
      // Section retries due to no model keys
      'my-gemini-key', // OPENROUTER_API_KEY (actually prompts for all again)
      '',           // MODAL_API_KEY
      '',           // GEMINI_API_KEY
      '',           // GROQ_API_KEY
      '',           // TELEGRAM_BOT_TOKEN
      '',           // TELEGRAM_USER_ID
      '',           // WHATSAPP_PHONE_NUMBER
      'ollama',     // EMBEDDING_PROVIDER
      'y'           // Summary Confirmation
    ];

    const prompter = new MockPrompter(answers);
    const result = await runSetupWizard({
      configPathOverride: configPath,
      prompter,
    });

    expect(result.status).toBe('success');
    const config = await readJson(configPath);
    expect((config['models'] as any)['openRouterApiKey']).toBe('my-gemini-key');
  });

  it('supports editing a section from the summary screen', async () => {
    const answers = [
      'secret-1',     // API_SECRET
      '3100',         // API_PORT
      'key-1',        // OPENROUTER_API_KEY
      '', '', '',     // Others
      '', '', '',     // Messaging
      'openai',       // EMBEDDING_PROVIDER
      'e',            // Summary choice: Edit
      '1',            // Section 1 (Runtime)
      'secret-2',     // New API_SECRET
      '3200',         // New API_PORT
      'y'             // Summary Confirmation
    ];

    const prompter = new MockPrompter(answers);
    const result = await runSetupWizard({
      configPathOverride: configPath,
      prompter,
    });

    expect(result.status).toBe('success');
    const config = await readJson(configPath);
    expect((config['runtime'] as any)['apiSecret']).toBe('secret-2');
    expect((config['runtime'] as any)['apiPort']).toBe(3200);
  });
});
