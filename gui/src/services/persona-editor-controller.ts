import {
    ApiRequestError,
    TwinClawApi,
    type PersonaStateData,
    type PersonaStateErrorDiagnostics,
} from './api';

export type PersonaDocumentField = 'soul' | 'identity' | 'user';

export interface PersonaEditorState {
    soul: string;
    identity: string;
    user: string;
    revision: string | null;
    updatedAt: string | null;
    dirty: boolean;
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;
    hints: string[];
    saveMessage: string | null;
}

interface PersonaBaseline {
    soul: string;
    identity: string;
    user: string;
    revision: string;
    updatedAt: string;
}

function createInitialState(): PersonaEditorState {
    return {
        soul: '',
        identity: '',
        user: '',
        revision: null,
        updatedAt: null,
        dirty: false,
        isLoading: false,
        isSaving: false,
        error: null,
        hints: [],
        saveMessage: null,
    };
}

function parseDiagnostics(value: unknown): PersonaStateErrorDiagnostics {
    if (!value || typeof value !== 'object') {
        return { hints: [] };
    }

    const candidate = value as { hints?: unknown; latestRevision?: unknown };
    const hints = Array.isArray(candidate.hints)
        ? candidate.hints.filter((entry): entry is string => typeof entry === 'string')
        : [];

    return {
        hints,
        latestRevision: typeof candidate.latestRevision === 'string' ? candidate.latestRevision : undefined,
    };
}

export class PersonaEditorController {
    #state: PersonaEditorState = createInitialState();
    #baseline: PersonaBaseline | null = null;
    readonly #subscribers = new Set<(state: PersonaEditorState) => void>();

    getState(): PersonaEditorState {
        return this.#state;
    }

    subscribe(callback: (state: PersonaEditorState) => void): () => void {
        this.#subscribers.add(callback);
        return () => {
            this.#subscribers.delete(callback);
        };
    }

    async load(): Promise<void> {
        this.#setState({
            ...this.#state,
            isLoading: true,
            error: null,
            hints: [],
            saveMessage: null,
        });

        try {
            const state = await TwinClawApi.getPersonaState();
            this.#applyLoadedState(state);
        } catch (error) {
            this.#setState({
                ...this.#state,
                isLoading: false,
                error: error instanceof Error ? error.message : String(error),
                hints: [],
                saveMessage: null,
            });
        }
    }

    updateField(field: PersonaDocumentField, value: string): void {
        const nextState: PersonaEditorState = {
            ...this.#state,
            [field]: value,
            saveMessage: null,
            error: null,
            hints: [],
            dirty: this.#baseline
                ? this.#isDirtyFromBaseline({
                    ...this.#state,
                    [field]: value,
                })
                : true,
        };
        this.#setState(nextState);
    }

    async save(): Promise<void> {
        if (this.#state.isSaving || this.#state.isLoading) {
            return;
        }

        if (!this.#state.revision) {
            this.#setState({
                ...this.#state,
                error: 'Persona state is not loaded yet. Reload and try again.',
                hints: ['Use Reload before saving if state failed to load.'],
                saveMessage: null,
            });
            return;
        }

        this.#setState({
            ...this.#state,
            isSaving: true,
            error: null,
            hints: [],
            saveMessage: null,
        });

        try {
            const result = await TwinClawApi.updatePersonaState({
                expectedRevision: this.#state.revision,
                soul: this.#state.soul,
                identity: this.#state.identity,
                user: this.#state.user,
            });

            this.#applyLoadedState(result.state);
            this.#setState({
                ...this.#state,
                saveMessage:
                    result.diagnostics.outcome === 'noop'
                        ? 'No changes detected.'
                        : `Saved (${result.diagnostics.changedDocuments.join(', ')})`,
                hints: result.diagnostics.warnings,
                isSaving: false,
            });
        } catch (error) {
            if (error instanceof ApiRequestError) {
                const diagnostics = parseDiagnostics(error.diagnostics);
                const hints = diagnostics.hints;
                const staleHint = diagnostics.latestRevision
                    ? [`Latest revision: ${diagnostics.latestRevision}`, ...hints]
                    : hints;

                this.#setState({
                    ...this.#state,
                    isSaving: false,
                    error: error.message,
                    hints: staleHint,
                    saveMessage: null,
                });
                return;
            }

            this.#setState({
                ...this.#state,
                isSaving: false,
                error: error instanceof Error ? error.message : String(error),
                hints: [],
                saveMessage: null,
            });
        }
    }

    #applyLoadedState(state: PersonaStateData): void {
        this.#baseline = {
            soul: state.soul,
            identity: state.identity,
            user: state.user,
            revision: state.revision,
            updatedAt: state.updatedAt,
        };

        this.#setState({
            soul: state.soul,
            identity: state.identity,
            user: state.user,
            revision: state.revision,
            updatedAt: state.updatedAt,
            dirty: false,
            isLoading: false,
            isSaving: false,
            error: null,
            hints: [],
            saveMessage: null,
        });
    }

    #isDirtyFromBaseline(nextState: Pick<PersonaEditorState, 'soul' | 'identity' | 'user'>): boolean {
        if (!this.#baseline) {
            return true;
        }

        return (
            nextState.soul !== this.#baseline.soul ||
            nextState.identity !== this.#baseline.identity ||
            nextState.user !== this.#baseline.user
        );
    }

    #setState(nextState: PersonaEditorState): void {
        this.#state = nextState;
        for (const subscriber of this.#subscribers) {
            subscriber(this.#state);
        }
    }
}
