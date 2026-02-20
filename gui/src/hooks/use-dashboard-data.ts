import { useState, useEffect } from 'react';
import { DashboardStatePoller, type DashboardState } from '../services/dashboard-poller';
import { useWebSocketStream } from './use-websocket-stream';

// In a real app with strict DI this instance might live in Context
// For this single-dashboard demo, a singleton works perfectly.
const globalPoller = new DashboardStatePoller(5000);
let isStarted = false;

export function useDashboardData() {
    const [state, setState] = useState<DashboardState>(() => globalPoller.getState());

    // Live WebSocket stream — provides real-time updates for incidents, routing,
    // reliability. Falls back gracefully when WS is unavailable.
    const ws = useWebSocketStream();

    useEffect(() => {
        if (!isStarted) {
            globalPoller.start();
            isStarted = true;
        }

        const unsubscribe = globalPoller.subscribe(setState);

        return () => {
            unsubscribe();
        };
    }, []);

    // Bridge live WS data into the poller state and suppress redundant polling
    useEffect(() => {
        const isLive = ws.connectionState === 'ready';
        globalPoller.wsTransportActive = isLive;

        if (isLive) {
            const patch: Parameters<typeof globalPoller.applyWsUpdate>[0] = {};
            if (ws.incidentsCurrent) patch.incidentsCurrent = ws.incidentsCurrent;
            if (ws.reliability) patch.reliability = ws.reliability;
            if (Object.keys(patch).length > 0) {
                globalPoller.applyWsUpdate(patch);
            }
        } else {
            // WS not ready — ensure poller is running in full-fallback mode
            globalPoller.wsTransportActive = false;
        }
    }, [ws.connectionState, ws.incidentsCurrent, ws.routing, ws.reliability]);

    return {
        ...state,
        // Overlay live routing data from WS when available
        routing: ws.connectionState === 'ready' && ws.routing ? ws.routing : (state.health?.routing ?? null),
        wsConnectionState: ws.connectionState,
        wsRetryCount: ws.retryCount,
        refresh: () => globalPoller.fetchAll(),
    };
}
