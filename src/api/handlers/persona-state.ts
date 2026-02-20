import type { Request, Response } from 'express';
import type { ApiEnvelope, PersonaStateErrorDiagnostics } from '../../types/api.js';
import type { PersonaStateService } from '../../services/persona-state.js';
import {
  PersonaConflictError,
  PersonaValidationError,
  type PersonaStateUpdateInput,
} from '../../types/persona-state.js';
import { sendError, sendOk } from '../shared.js';

export interface PersonaStateDeps {
  personaStateService: PersonaStateService;
}

function sendPersonaDiagnosticError(
  res: Response,
  status: number,
  message: string,
  diagnostics: PersonaStateErrorDiagnostics,
): void {
  const correlationId = res.locals.correlationId as string | undefined;
  const body: ApiEnvelope<PersonaStateErrorDiagnostics> = {
    ok: false,
    error: message,
    data: diagnostics,
    correlationId,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

export function handlePersonaStateGet(deps: PersonaStateDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const state = await deps.personaStateService.getState();
      sendOk(res, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(res, `Failed to load persona state: ${message}`, 500);
    }
  };
}

export function handlePersonaStateUpdate(deps: PersonaStateDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Partial<Record<'expectedRevision' | 'soul' | 'identity' | 'user', unknown>>;
    const input: PersonaStateUpdateInput = {
      expectedRevision: body.expectedRevision,
      soul: body.soul,
      identity: body.identity,
      user: body.user,
    };

    try {
      const result = await deps.personaStateService.updateState(input);
      sendOk(res, result);
    } catch (error) {
      if (error instanceof PersonaValidationError) {
        sendPersonaDiagnosticError(res, 400, error.message, {
          hints: error.hints,
        });
        return;
      }

      if (error instanceof PersonaConflictError) {
        sendPersonaDiagnosticError(res, 409, error.message, {
          hints: error.hints,
          latestRevision: error.latestRevision,
        });
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      sendPersonaDiagnosticError(res, 500, `Failed to update persona state: ${message}`, {
        hints: ['Retry the operation. If it persists, inspect local filesystem permissions.'],
      });
    }
  };
}
