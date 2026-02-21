import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBuiltinSkills } from '../../src/skills/builtin.js';
import { Gateway } from '../../src/core/gateway.js';
import type { Message, Tool } from '../../src/core/types.js';
import type { ModelRouter } from '../../src/services/model-router.js';
import { SkillRegistry } from '../../src/services/skill-registry.js';
import { MockModelRouter } from './mock-router.js';

describe('Native tool inventory harmonization', () => {
  const envSnapshot: Record<string, string | undefined> = {};
  const touchedFiles: string[] = [];

  beforeEach(() => {
    envSnapshot.MODAL_API_KEY = process.env.MODAL_API_KEY;
    envSnapshot.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    envSnapshot.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    process.env.MODAL_API_KEY = 'test-modal';
    process.env.OPENROUTER_API_KEY = 'test-openrouter';
    process.env.GEMINI_API_KEY = 'test-gemini';
  });

  afterEach(async () => {
    for (const filePath of touchedFiles.splice(0, touchedFiles.length)) {
      await rm(filePath, { force: true }).catch(() => undefined);
    }

    restoreEnv('MODAL_API_KEY', envSnapshot.MODAL_API_KEY);
    restoreEnv('OPENROUTER_API_KEY', envSnapshot.OPENROUTER_API_KEY);
    restoreEnv('GEMINI_API_KEY', envSnapshot.GEMINI_API_KEY);
  });

  it('exposes grouped native tools with legacy aliases', () => {
    const builtinSkills = createBuiltinSkills();
    const names = builtinSkills.map((skill) => skill.name);

    expect(names).toContain('fs.read');
    expect(names).toContain('fs.apply_patch');
    expect(names).toContain('runtime.exec');
    expect(builtinSkills.find((skill) => skill.name === 'fs.read')?.aliases).toContain('read_file');
    expect(builtinSkills.find((skill) => skill.name === 'runtime.exec')?.aliases).toContain('shell_execute');
    expect(builtinSkills.every((skill) => skill.group?.startsWith('group:'))).toBe(true);
  });

  it('blocks unsafe runtime commands by default', async () => {
    const runtimeExec = createBuiltinSkills().find((skill) => skill.name === 'runtime.exec');
    expect(runtimeExec).toBeDefined();

    const result = await runtimeExec!.execute({ command: 'shutdown now' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Blocked unsafe command');
  });

  it('applies patches through gateway tool execution flow', async () => {
    const targetFileName = `tool-harmonization-${randomUUID()}.txt`;
    const targetFilePath = path.resolve(process.cwd(), targetFileName);
    touchedFiles.push(targetFilePath);

    await writeFile(targetFilePath, 'alpha\n', 'utf8');

    const patch = [
      `diff --git a/${targetFileName} b/${targetFileName}`,
      `--- a/${targetFileName}`,
      `+++ b/${targetFileName}`,
      '@@ -1 +1 @@',
      '-alpha',
      '+beta',
      '',
    ].join('\n');

    const router = new MockModelRouter();
    router.attachFetchMock();
    router.setMockResponses([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_patch_1',
            type: 'function',
            function: {
              name: 'fs.apply_patch',
              arguments: JSON.stringify({ patch }),
            },
          },
        ],
      },
      {
        role: 'assistant',
        content: 'Patch complete.',
      },
    ]);

    try {
      const registry = new SkillRegistry();
      registry.registerMany(createBuiltinSkills());
      const gateway = new Gateway(registry, {
        router,
        policyEngine: undefined,
        maxToolRounds: 4,
        enableDelegation: false,
      });

      const response = await gateway.processText(`patch-test-${randomUUID()}`, 'Apply the pending patch.');
      expect(response).toContain('Patch complete');
      expect(await readFile(targetFilePath, 'utf8')).toBe('beta\n');
    } finally {
      router.detachFetchMock();
    }
  });

  it('filters tools with allow and deny policy before router exposure', async () => {
    class CapturingRouter {
      public lastTools: Tool[] = [];

      async createChatCompletion(_messages: Message[], tools?: Tool[]): Promise<Message> {
        this.lastTools = tools ?? [];
        return { role: 'assistant', content: 'ok' };
      }
    }

    const capturingRouter = new CapturingRouter();
    const registry = new SkillRegistry();
    registry.registerMany(createBuiltinSkills());
    const gateway = new Gateway(registry, {
      router: capturingRouter as unknown as ModelRouter,
      enableDelegation: false,
      toolPolicy: {
        allow: ['group:fs'],
        deny: ['fs.apply_patch'],
      },
    });

    await gateway.processText(`policy-test-${randomUUID()}`, 'hello');
    const names = capturingRouter.lastTools.map((tool) => tool.name);

    expect(names).toContain('fs.read');
    expect(names).toContain('fs.list');
    expect(names).not.toContain('fs.apply_patch');
    expect(names.some((name) => name.startsWith('runtime.'))).toBe(false);
  });
});

function restoreEnv(
  key: 'MODAL_API_KEY' | 'OPENROUTER_API_KEY' | 'GEMINI_API_KEY',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
