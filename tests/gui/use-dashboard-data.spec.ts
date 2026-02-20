import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashboardStatePoller } from '../../gui/src/services/dashboard-poller';
import { TwinClawApi } from '../../gui/src/services/api';

vi.mock('../../gui/src/services/api', () => ({
    TwinClawApi: {
        getHealth: vi.fn(),
        getReliability: vi.fn(),
        getLogs: vi.fn(),
        getIncidentsCurrent: vi.fn(),
        getIncidentsHistory: vi.fn(),
    },
}));

describe('DashboardStatePoller', () => {
    let poller: DashboardStatePoller;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // Default document hidden mock
        global.document = {
            hidden: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as any;

        vi.mocked(TwinClawApi.getLogs).mockResolvedValue([]);
        vi.mocked(TwinClawApi.getIncidentsCurrent).mockResolvedValue(mockIncidentCurrent as any);
        vi.mocked(TwinClawApi.getIncidentsHistory).mockResolvedValue(mockIncidentHistory as any);

        poller = new DashboardStatePoller(5000);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const mockHealth = {
        status: 'ok',
        uptimeSec: 3600,
        memoryUsageMb: 120,
        skills: { builtin: 5, mcp: 2 },
        mcpServers: []
    };

    const mockReliability = {
        totalDelivered: 100,
        totalFailed: 2,
        pendingRetries: 0,
        recentFailures: []
    };

    const mockIncidentCurrent = {
        safeMode: false,
        incidents: [],
    };

    const mockIncidentHistory = {
        incidents: [],
        timeline: [],
    };

    it('fetches initial data successfully', async () => {
        vi.mocked(TwinClawApi.getHealth).mockResolvedValue(mockHealth as any);
        vi.mocked(TwinClawApi.getReliability).mockResolvedValue(mockReliability as any);

        expect(poller.getState().isInitialLoad).toBe(true);

        // Simulate mount
        poller.start();

        // Let initial promises resolve
        await vi.advanceTimersByTimeAsync(0);

        expect(poller.getState().isInitialLoad).toBe(false);
        expect(poller.getState().health).toEqual(mockHealth);
        expect(poller.getState().reliability).toEqual(mockReliability);
        expect(poller.getState().incidentsCurrent).toEqual(mockIncidentCurrent);
        expect(poller.getState().incidentHistory).toEqual(mockIncidentHistory);
        expect(poller.getState().error).toBeNull();

        poller.stop();
    });

    it('handles health check failures gracefully', async () => {
        vi.mocked(TwinClawApi.getHealth).mockRejectedValue(new Error('Connection Refused'));
        vi.mocked(TwinClawApi.getReliability).mockResolvedValue(mockReliability as any);

        poller.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(poller.getState().isInitialLoad).toBe(false);
        expect(poller.getState().error).toBe('Connection Refused');
        expect(poller.getState().health).toBeNull();

        poller.stop();
    });

    it('tolerates reliability metric failures without dropping health', async () => {
        vi.mocked(TwinClawApi.getHealth).mockResolvedValue(mockHealth as any);
        vi.mocked(TwinClawApi.getReliability).mockRejectedValue(new Error('Dispatcher offline'));

        poller.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(poller.getState().isInitialLoad).toBe(false);
        expect(poller.getState().error).toBeNull();
        expect(poller.getState().health).toEqual(mockHealth);
        expect(poller.getState().reliability).toBeNull();

        poller.stop();
    });

    it('tolerates incident endpoint failures without dropping health', async () => {
        vi.mocked(TwinClawApi.getHealth).mockResolvedValue(mockHealth as any);
        vi.mocked(TwinClawApi.getReliability).mockResolvedValue(mockReliability as any);
        vi.mocked(TwinClawApi.getIncidentsCurrent).mockRejectedValue(new Error('Incident manager offline'));
        vi.mocked(TwinClawApi.getIncidentsHistory).mockRejectedValue(new Error('Timeline unavailable'));

        poller.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(poller.getState().isInitialLoad).toBe(false);
        expect(poller.getState().error).toBeNull();
        expect(poller.getState().health).toEqual(mockHealth);
        expect(poller.getState().incidentsCurrent).toBeNull();
        expect(poller.getState().incidentHistory).toBeNull();

        poller.stop();
    });

    it('polls at the specified interval', async () => {
        vi.mocked(TwinClawApi.getHealth).mockResolvedValue(mockHealth as any);
        vi.mocked(TwinClawApi.getReliability).mockResolvedValue(mockReliability as any);

        poller.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(TwinClawApi.getHealth).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5000);

        expect(TwinClawApi.getHealth).toHaveBeenCalledTimes(2);

        poller.stop();
    });
});
