import {
    TwinClawApi,
    type SystemHealth,
    type ReliabilityData,
    type LogEntry,
    type IncidentCurrentData,
    type IncidentHistoryData,
} from './api';

export interface DashboardState {
    health: SystemHealth | null;
    reliability: ReliabilityData | null;
    logs: LogEntry[];
    incidentsCurrent: IncidentCurrentData | null;
    incidentHistory: IncidentHistoryData | null;
    error: string | null;
    isInitialLoad: boolean;
    lastUpdated: Date | null;
    /** True when WS transport is providing live updates for some fields. */
    wsActive: boolean;
}

export class DashboardStatePoller {
    private state: DashboardState;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private isFetching = false;
    private subscribers = new Set<(state: DashboardState) => void>();
    private readonly visibilityHandler: () => void;

    private readonly pollingIntervalMs: number;

    /**
     * When true the poller skips fetching fields already delivered live via WS
     * (incidents, routing, reliability) to avoid redundant HTTP round-trips.
     * Set this flag from `use-websocket-stream.ts` once the WS connection is
     * established so the fallback polling path remains active when WS is down.
     */
    wsTransportActive = false;

    constructor(pollingIntervalMs = 5000) {
        this.pollingIntervalMs = pollingIntervalMs;
        this.state = {
            health: null,
            reliability: null,
            logs: [],
            incidentsCurrent: null,
            incidentHistory: null,
            error: null,
            isInitialLoad: true,
            lastUpdated: null,
            wsActive: false,
        };

        this.visibilityHandler = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                void this.fetchAll();
            }
        };
    }

    getState() {
        return this.state;
    }

    subscribe(callback: (state: DashboardState) => void) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /** Merge live WS-delivered data directly into state and notify subscribers. */
    applyWsUpdate(patch: Partial<Pick<DashboardState, 'incidentsCurrent' | 'reliability' | 'incidentHistory'>>) {
        this.state = {
            ...this.state,
            ...patch,
            wsActive: true,
            lastUpdated: new Date(),
        };
        this.notify();
    }

    private notify() {
        this.subscribers.forEach(cb => cb(this.state));
    }

    start() {
        // Initial fetch
        void this.fetchAll();

        // Setup polling interval
        this.intervalId = setInterval(() => this.fetchAll(), this.pollingIntervalMs);

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
        }
    }

    async fetchAll() {
        // Prevent overlapping fetches if the API is slow
        if (this.isFetching) return;

        // Check tab visibility to save resources
        if (typeof document !== 'undefined' && document.hidden) return;

        this.isFetching = true;

        try {
            // Always fetch health and logs via HTTP — they are not streamed over WS
            const [health, logs] = await Promise.all([
                TwinClawApi.getHealth(),
                TwinClawApi.getLogs().catch(err => {
                    console.warn('Failed to fetch logs:', err);
                    return [];
                }),
            ]);

            const patch: Partial<DashboardState> = { health, logs };

            // Only poll these via HTTP when WS transport is not active
            if (!this.wsTransportActive) {
                const [reliability, incidentsCurrent, incidentHistory] = await Promise.all([
                    TwinClawApi.getReliability().catch(err => {
                        console.warn('Failed to fetch reliability metrics:', err);
                        return null;
                    }),
                    TwinClawApi.getIncidentsCurrent().catch(err => {
                        console.warn('Failed to fetch current incidents:', err);
                        return null;
                    }),
                    TwinClawApi.getIncidentsHistory().catch(err => {
                        console.warn('Failed to fetch incident history:', err);
                        return null;
                    }),
                ]);
                patch.reliability = reliability;
                patch.incidentsCurrent = incidentsCurrent;
                patch.incidentHistory = incidentHistory;
            }

            this.state = {
                ...this.state,
                ...patch,
                error: null,
                isInitialLoad: false,
                lastUpdated: new Date(),
            };
        } catch (error) {
            this.state = {
                ...this.state,
                error: error instanceof Error ? error.message : String(error),
                isInitialLoad: false,
            };
        } finally {
            this.isFetching = false;
            this.notify();
        }
    }
}
