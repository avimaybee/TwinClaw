import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRouter } from '../../src/services/model-router.js';
import type { Message } from '../../src/core/types.js';

const BASE_MESSAGES: Message[] = [{ role: 'user', content: 'hello' }];

describe('ModelRouter failover behavior', () => {
  let originalFetch: typeof globalThis.fetch;
  let envSnapshot: Partial<Record<'MODAL_API_KEY' | 'OPENROUTER_API_KEY' | 'GEMINI_API_KEY', string>>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    envSnapshot = {
      MODAL_API_KEY: process.env.MODAL_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MODAL_API_KEY', envSnapshot.MODAL_API_KEY);
    restoreEnv('OPENROUTER_API_KEY', envSnapshot.OPENROUTER_API_KEY);
    restoreEnv('GEMINI_API_KEY', envSnapshot.GEMINI_API_KEY);
    vi.restoreAllMocks();
  });

  it('falls back after a 429 rate limit response', async () => {
    process.env.MODAL_API_KEY = 'modal-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.GEMINI_API_KEY = 'gemini-key';

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'fallback success' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    globalThis.fetch = fetchMock;

    const router = new ModelRouter();
    const message = await router.createChatCompletion(BASE_MESSAGES);

    expect(message.content).toBe('fallback success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('modal.direct');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('openrouter.ai');
  });

  it('falls back after non-200 upstream failures', async () => {
    process.env.MODAL_API_KEY = 'modal-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.GEMINI_API_KEY = 'gemini-key';

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('upstream exploded', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'recovered via fallback' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    globalThis.fetch = fetchMock;

    const router = new ModelRouter();
    const message = await router.createChatCompletion(BASE_MESSAGES);

    expect(message.content).toBe('recovered via fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips providers without API keys and uses available providers', async () => {
    delete process.env.MODAL_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = 'gemini-key';

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'gemini response' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock;

    const router = new ModelRouter();
    const message = await router.createChatCompletion(BASE_MESSAGES);

    expect(message.content).toBe('gemini response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('generativelanguage.googleapis.com');
  });

  it('throws when all providers are unavailable', async () => {
    delete process.env.MODAL_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    const router = new ModelRouter();
    await expect(router.createChatCompletion(BASE_MESSAGES)).rejects.toThrow(
      'All configured models exhausted or failed',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps fallback integrity under hard budget limits', async () => {
    process.env.MODAL_API_KEY = 'modal-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.GEMINI_API_KEY = 'gemini-key';

    const budgetGovernor = {
      getRoutingDirective: vi.fn().mockReturnValue({
        profile: 'economy',
        severity: 'hard_limit',
        actions: ['fallback_tightening'],
        pacingDelayMs: 0,
        blockedModelIds: ['primary'],
        blockedProviders: [],
        reason: 'hard budget',
        evaluatedAt: new Date().toISOString(),
      }),
      recordUsage: vi.fn(),
      applyProviderCooldown: vi.fn(),
      getSnapshot: vi.fn(),
      setManualProfile: vi.fn(),
      resetPolicyState: vi.fn(),
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('gemini failed', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'budget-safe fallback' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    globalThis.fetch = fetchMock;

    const router = new ModelRouter({ budgetGovernor: budgetGovernor as any });
    const message = await router.createChatCompletion(BASE_MESSAGES, undefined, { sessionId: 'budget-test' });

    expect(message.content).toBe('budget-safe fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('generativelanguage.googleapis.com');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('openrouter.ai');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('modal.direct'))).toBe(false);
    expect(budgetGovernor.recordUsage).toHaveBeenCalled();
  });

  it('retries in-place with intelligent_pacing before failing over', async () => {
    process.env.MODAL_API_KEY = 'modal-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.GEMINI_API_KEY = 'gemini-key';

    let now = Date.now();
    const waits: number[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'recovered on same model' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    globalThis.fetch = fetchMock;

    const router = new ModelRouter({
      fallbackMode: 'intelligent_pacing',
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      defaultRateLimitCooldownMs: 1_000,
      intelligentPacingMaxWaitMs: 1_000,
    });

    const message = await router.createChatCompletion(BASE_MESSAGES);
    const snapshot = router.getHealthSnapshot();

    expect(message.content).toBe('recovered on same model');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('modal.direct');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('modal.direct');
    expect(waits).toEqual([1000]);
    expect(snapshot.failoverCount).toBe(0);
    expect(snapshot.fallbackMode).toBe('intelligent_pacing');
  });

  it('records cooldown telemetry when aggressive fallback switches provider', async () => {
    process.env.MODAL_API_KEY = 'modal-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.GEMINI_API_KEY = 'gemini-key';

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'fallback provider answered' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    globalThis.fetch = fetchMock;

    const router = new ModelRouter({ fallbackMode: 'aggressive_fallback', defaultRateLimitCooldownMs: 30_000 });
    const message = await router.createChatCompletion(BASE_MESSAGES);
    const snapshot = router.getHealthSnapshot();

    expect(message.content).toBe('fallback provider answered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('modal.direct');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('openrouter.ai');
    expect(snapshot.activeCooldowns.some((cooldown) => cooldown.modelId === 'primary')).toBe(true);
    expect(snapshot.recentEvents.some((event) => event.type === 'rate_limit')).toBe(true);
    expect(snapshot.failoverCount).toBeGreaterThanOrEqual(1);
  });

  it('updates fallback mode through control setter and exposes mode_change event', () => {
    const router = new ModelRouter({ fallbackMode: 'aggressive_fallback' });
    const snapshot = router.setFallbackMode('intelligent_pacing');

    expect(snapshot.fallbackMode).toBe('intelligent_pacing');
    expect(snapshot.recentEvents[0]?.type).toBe('mode_change');
  });
});

function restoreEnv(name: 'MODAL_API_KEY' | 'OPENROUTER_API_KEY' | 'GEMINI_API_KEY', value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
