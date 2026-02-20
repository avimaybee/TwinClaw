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
}

export class DashboardStatePoller {
    private state: DashboardState;
    private intervalId: any = null;
    private isFetching = false;
    private subscribers = new Set<(state: DashboardState) => void>();
    private readonly visibilityHandler: () => void;

    private readonly pollingIntervalMs: number;

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
            const [health, reliability, logs, incidentsCurrent, incidentHistory] = await Promise.all([
                TwinClawApi.getHealth(),
                TwinClawApi.getReliability().catch(err => {
                    console.warn('Failed to fetch reliability metrics:', err);
                    return null;
                }),
                TwinClawApi.getLogs().catch(err => {
                    console.warn('Failed to fetch logs:', err);
                    return [];
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

            this.state = {
                ...this.state,
                health,
                reliability,
                logs,
                incidentsCurrent,
                incidentHistory,
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
