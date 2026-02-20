import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaEditorController } from '../../gui/src/services/persona-editor-controller';
import { ApiRequestError, TwinClawApi } from '../../gui/src/services/api';

vi.mock('../../gui/src/services/api', async () => {
  const actual = await vi.importActual<typeof import('../../gui/src/services/api')>(
    '../../gui/src/services/api',
  );

  return {
    ...actual,
    TwinClawApi: {
      ...actual.TwinClawApi,
      getPersonaState: vi.fn(),
      updatePersonaState: vi.fn(),
    },
  };
});

describe('PersonaEditorController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads persona state for editing', async () => {
    vi.mocked(TwinClawApi.getPersonaState).mockResolvedValue({
      revision: 'rev-1',
      updatedAt: new Date('2026-02-20T10:00:00.000Z').toISOString(),
      soul: 'soul-value',
      identity: 'identity-value',
      user: 'user-value',
    });

    const controller = new PersonaEditorController();
    await controller.load();
    const state = controller.getState();

    expect(state.revision).toBe('rev-1');
    expect(state.soul).toBe('soul-value');
    expect(state.identity).toBe('identity-value');
    expect(state.user).toBe('user-value');
    expect(state.dirty).toBe(false);
    expect(state.error).toBeNull();
  });

  it('persists edited persona state', async () => {
    vi.mocked(TwinClawApi.getPersonaState).mockResolvedValue({
      revision: 'rev-1',
      updatedAt: new Date('2026-02-20T10:00:00.000Z').toISOString(),
      soul: 'soul-value',
      identity: 'identity-value',
      user: 'user-value',
    });
    vi.mocked(TwinClawApi.updatePersonaState).mockResolvedValue({
      state: {
        revision: 'rev-2',
        updatedAt: new Date('2026-02-20T10:05:00.000Z').toISOString(),
        soul: 'updated-soul',
        identity: 'identity-value',
        user: 'user-value',
      },
      diagnostics: {
        outcome: 'updated',
        changedDocuments: ['soul'],
        warnings: [],
      },
    });

    const controller = new PersonaEditorController();
    await controller.load();
    controller.updateField('soul', 'updated-soul');
    await controller.save();

    expect(TwinClawApi.updatePersonaState).toHaveBeenCalledWith({
      expectedRevision: 'rev-1',
      soul: 'updated-soul',
      identity: 'identity-value',
      user: 'user-value',
    });

    const state = controller.getState();
    expect(state.revision).toBe('rev-2');
    expect(state.dirty).toBe(false);
    expect(state.error).toBeNull();
    expect(state.saveMessage).toContain('Saved');
  });

  it('surfaces diagnostics on save conflicts', async () => {
    vi.mocked(TwinClawApi.getPersonaState).mockResolvedValue({
      revision: 'rev-1',
      updatedAt: new Date('2026-02-20T10:00:00.000Z').toISOString(),
      soul: 'soul-value',
      identity: 'identity-value',
      user: 'user-value',
    });
    vi.mocked(TwinClawApi.updatePersonaState).mockRejectedValue(
      new ApiRequestError('Persona state is stale. Reload and retry.', 409, {
        hints: ['Reload persona state before saving again.'],
        latestRevision: 'rev-2',
      }),
    );

    const controller = new PersonaEditorController();
    await controller.load();
    controller.updateField('identity', 'changed-identity');
    await controller.save();

    const state = controller.getState();
    expect(state.error).toBe('Persona state is stale. Reload and retry.');
    expect(state.hints.some((hint) => hint.includes('Latest revision'))).toBe(true);
    expect(state.dirty).toBe(true);
  });
});
