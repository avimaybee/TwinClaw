export const PERSONA_DOCUMENT_KEYS = ['soul', 'identity', 'user'] as const;

export type PersonaDocumentKey = (typeof PERSONA_DOCUMENT_KEYS)[number];

export interface PersonaStateSnapshot {
  revision: string;
  updatedAt: string;
  soul: string;
  identity: string;
  user: string;
}

export interface PersonaStateUpdateInput {
  expectedRevision: unknown;
  soul: unknown;
  identity: unknown;
  user: unknown;
}

export interface PersonaStateValidatedUpdateInput {
  expectedRevision: string;
  soul: string;
  identity: string;
  user: string;
}

export interface PersonaStateUpdateDiagnostics {
  outcome: 'updated' | 'noop';
  changedDocuments: PersonaDocumentKey[];
  warnings: string[];
}

export interface PersonaStateUpdateResult {
  state: PersonaStateSnapshot;
  diagnostics: PersonaStateUpdateDiagnostics;
}

export class PersonaValidationError extends Error {
  readonly hints: string[];

  constructor(hints: string[]) {
    super('Persona state validation failed.');
    this.name = 'PersonaValidationError';
    this.hints = hints;
  }
}

export class PersonaConflictError extends Error {
  readonly latestRevision: string;
  readonly hints: string[];

  constructor(latestRevision: string) {
    super('Persona state is stale. Reload and retry.');
    this.name = 'PersonaConflictError';
    this.latestRevision = latestRevision;
    this.hints = [
      'Reload persona state before saving again.',
      'Re-apply your edits on top of the latest revision.',
    ];
  }
}
