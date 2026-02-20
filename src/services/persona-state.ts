import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { logThought } from '../utils/logger.js';
import {
  PERSONA_DOCUMENT_KEYS,
  type PersonaDocumentKey,
  type PersonaStateSnapshot,
  type PersonaStateUpdateInput,
  type PersonaStateUpdateResult,
  type PersonaStateValidatedUpdateInput,
  PersonaConflictError,
  PersonaValidationError,
} from '../types/persona-state.js';

interface PersonaDocumentState {
  content: string;
  updatedAtMs: number;
}

interface PersonaWritePlan {
  key: PersonaDocumentKey;
  targetPath: string;
  tempPath: string;
  backupPath: string;
  hadOriginal: boolean;
  applied: boolean;
  originalRemoved: boolean;
}

export interface PersonaStateFsAdapter {
  access(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ mtimeMs: number }>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
}

export interface PersonaStateServiceOptions {
  identityDir?: string;
  now?: () => Date;
  fsAdapter?: PersonaStateFsAdapter;
  auditLogger?: (message: string) => Promise<void> | void;
}

const MAX_PERSONA_FIELD_LENGTH = 120_000;

const DEFAULT_FS_ADAPTER: PersonaStateFsAdapter = {
  access,
  copyFile,
  mkdir: async (targetPath, options) => {
    await mkdir(targetPath, options);
  },
  readFile,
  rename,
  rm: async (targetPath, options) => {
    await rm(targetPath, { force: options?.force ?? false });
  },
  stat,
  writeFile,
};

export class PersonaStateService {
  readonly #identityDir: string;
  readonly #now: () => Date;
  readonly #fs: PersonaStateFsAdapter;
  readonly #auditLogger: (message: string) => Promise<void> | void;

  constructor(options: PersonaStateServiceOptions = {}) {
    this.#identityDir = options.identityDir ?? path.resolve('identity');
    this.#now = options.now ?? (() => new Date());
    this.#fs = options.fsAdapter ?? DEFAULT_FS_ADAPTER;
    this.#auditLogger = options.auditLogger ?? logThought;
  }

  async getState(): Promise<PersonaStateSnapshot> {
    await this.#fs.mkdir(this.#identityDir, { recursive: true });

    const soul = await this.#readDocument('soul');
    const identity = await this.#readDocument('identity');
    const user = await this.#readDocument('user');

    const revision = this.#computeRevision({
      soul: soul.content,
      identity: identity.content,
      user: user.content,
    });
    const latestUpdatedAtMs = Math.max(soul.updatedAtMs, identity.updatedAtMs, user.updatedAtMs);

    return {
      revision,
      updatedAt:
        latestUpdatedAtMs > 0
          ? new Date(latestUpdatedAtMs).toISOString()
          : this.#now().toISOString(),
      soul: soul.content,
      identity: identity.content,
      user: user.content,
    };
  }

  async updateState(input: PersonaStateUpdateInput): Promise<PersonaStateUpdateResult> {
    const normalizedInput = this.#validateUpdateInput(input);
    const currentState = await this.getState();

    if (normalizedInput.expectedRevision !== currentState.revision) {
      throw new PersonaConflictError(currentState.revision);
    }

    const nextState = {
      soul: normalizedInput.soul,
      identity: normalizedInput.identity,
      user: normalizedInput.user,
    };

    const changedDocuments = PERSONA_DOCUMENT_KEYS.filter((key) => {
      return currentState[key] !== nextState[key];
    });

    if (changedDocuments.length === 0) {
      return {
        state: currentState,
        diagnostics: {
          outcome: 'noop',
          changedDocuments: [],
          warnings: [],
        },
      };
    }

    const plans: PersonaWritePlan[] = [];
    const warnings: string[] = [];

    for (const key of changedDocuments) {
      const targetPath = this.#documentPath(key);
      const tempPath = `${targetPath}.tmp-${randomUUID()}`;
      const backupPath = `${targetPath}.bak-${randomUUID()}`;

      await this.#fs.writeFile(tempPath, nextState[key], 'utf8');
      const hadOriginal = await this.#fileExists(targetPath);
      if (hadOriginal) {
        await this.#fs.copyFile(targetPath, backupPath);
      }

      plans.push({
        key,
        targetPath,
        tempPath,
        backupPath,
        hadOriginal,
        applied: false,
        originalRemoved: false,
      });
    }

    try {
      for (const plan of plans) {
        await this.#removePathIfExists(plan.targetPath);
        plan.originalRemoved = true;
        await this.#fs.rename(plan.tempPath, plan.targetPath);
        plan.applied = true;
      }

      for (const plan of plans) {
        warnings.push(...(await this.#cleanupPath(plan.backupPath)));
      }

      const updatedState = await this.getState();
      await this.#auditLogger(
        `[PersonaState] Updated documents: ${changedDocuments.join(', ')} | revision=${updatedState.revision}`,
      );

      return {
        state: updatedState,
        diagnostics: {
          outcome: 'updated',
          changedDocuments,
          warnings,
        },
      };
    } catch (error) {
      const rollbackWarnings = await this.#rollbackPlans(plans);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const warningSuffix =
        rollbackWarnings.length > 0 ? ` | Rollback warnings: ${rollbackWarnings.join(' | ')}` : '';

      await this.#auditLogger(
        `[PersonaState] Update failed; rollback applied. ${errorMessage}${warningSuffix}`,
      );
      throw new Error(`Persona state update failed; rollback applied. ${errorMessage}${warningSuffix}`);
    } finally {
      for (const plan of plans) {
        warnings.push(...(await this.#cleanupPath(plan.tempPath)));
        warnings.push(...(await this.#cleanupPath(plan.backupPath)));
      }
    }
  }

  #validateUpdateInput(input: PersonaStateUpdateInput): PersonaStateValidatedUpdateInput {
    const hints: string[] = [];

    if (typeof input.expectedRevision !== 'string' || input.expectedRevision.trim().length === 0) {
      hints.push("'expectedRevision' must be a non-empty string.");
    }

    const soul = this.#validateField('soul', input.soul, hints);
    const identity = this.#validateField('identity', input.identity, hints);
    const user = this.#validateField('user', input.user, hints);

    if (hints.length > 0) {
      throw new PersonaValidationError(hints);
    }

    return {
      expectedRevision: input.expectedRevision as string,
      soul,
      identity,
      user,
    };
  }

  #validateField(name: PersonaDocumentKey, value: unknown, hints: string[]): string {
    if (typeof value !== 'string') {
      hints.push(`'${name}' must be a string.`);
      return '';
    }

    if (value.length > MAX_PERSONA_FIELD_LENGTH) {
      hints.push(`'${name}' exceeds ${MAX_PERSONA_FIELD_LENGTH} characters.`);
    }

    return value;
  }

  async #rollbackPlans(plans: PersonaWritePlan[]): Promise<string[]> {
    const warnings: string[] = [];
    const reversePlans = [...plans].reverse();

    for (const plan of reversePlans) {
      if (plan.applied || plan.originalRemoved) {
        if (plan.hadOriginal) {
          warnings.push(...(await this.#removePathIfExists(plan.targetPath)));
          try {
            await this.#fs.rename(plan.backupPath, plan.targetPath);
          } catch (error) {
            warnings.push(
              `Failed to restore backup for '${plan.key}': ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        } else {
          warnings.push(...(await this.#removePathIfExists(plan.targetPath)));
        }
      }

      warnings.push(...(await this.#cleanupPath(plan.tempPath)));
      warnings.push(...(await this.#cleanupPath(plan.backupPath)));
    }

    return warnings;
  }

  async #readDocument(key: PersonaDocumentKey): Promise<PersonaDocumentState> {
    const filePath = this.#documentPath(key);

    try {
      const [content, metadata] = await Promise.all([
        this.#fs.readFile(filePath, 'utf8'),
        this.#fs.stat(filePath),
      ]);

      return {
        content,
        updatedAtMs: Number.isFinite(metadata.mtimeMs) ? metadata.mtimeMs : 0,
      };
    } catch (error) {
      if (this.#isNotFound(error)) {
        return { content: '', updatedAtMs: 0 };
      }
      throw error;
    }
  }

  #computeRevision(value: { soul: string; identity: string; user: string }): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  #documentPath(key: PersonaDocumentKey): string {
    return path.join(this.#identityDir, `${key}.md`);
  }

  async #fileExists(targetPath: string): Promise<boolean> {
    try {
      await this.#fs.access(targetPath);
      return true;
    } catch (error) {
      if (this.#isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async #removePathIfExists(targetPath: string): Promise<string[]> {
    try {
      await this.#fs.rm(targetPath, { force: true });
      return [];
    } catch (error) {
      if (this.#isNotFound(error)) {
        return [];
      }
      return [
        `Failed to remove '${targetPath}': ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
  }

  async #cleanupPath(targetPath: string): Promise<string[]> {
    return this.#removePathIfExists(targetPath);
  }

  #isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    );
  }
}

let defaultPersonaStateService: PersonaStateService | null = null;

export function getPersonaStateService(): PersonaStateService {
  if (!defaultPersonaStateService) {
    defaultPersonaStateService = new PersonaStateService();
  }
  return defaultPersonaStateService;
}

export function resetPersonaStateServiceForTests(): void {
  defaultPersonaStateService = null;
}
