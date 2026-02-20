import { useState, useEffect, useRef } from 'react';
import { WsClient, type WsConnectionState, type WsEventEnvelope, type WsSnapshotPayload } from '../services/websocket-client';
import type { IncidentCurrentData, ReliabilityData } from '../services/api';
import type { ModelRoutingTelemetry } from '../services/api';

export interface WsStreamData {
    connectionState: WsConnectionState;
    retryCount: number;
    lastError: string | null;
    /** Available when connected and subscribed */
    incidentsCurrent: IncidentCurrentData | null;
    routing: ModelRoutingTelemetry | null;
    reliability: ReliabilityData | null;
}

/**
 * The WS token is read from the VITE_API_SECRET build-time environment variable.
 *
 * This GUI is a localhost-only operator control plane (not a public-facing app),
 * so the secret remains on the operator's machine. If the variable is not set,
 * the hook skips WebSocket connection entirely and the dashboard falls back to
 * HTTP polling — no silent failure or credential leakage occurs.
 */
const WS_TOKEN = import.meta.env.VITE_API_SECRET ?? '';
const SUBSCRIBED_TOPICS = ['incidents', 'routing', 'reliability'] as const;

/**
 * React hook that manages a live WebSocket connection to the TwinClaw
 * control-plane stream.
 *
 * Provides real-time incident, routing, and reliability state from the hub.
 * The caller should preserve the HTTP polling path as a fallback when
 * `connectionState` is 'exhausted' or the received data is null.
 */
export function useWebSocketStream(): WsStreamData {
    const [connectionState, setConnectionState] = useState<WsConnectionState>('idle');
    const [retryCount, setRetryCount] = useState(0);
    const [lastError, setLastError] = useState<string | null>(null);
    const [incidentsCurrent, setIncidentsCurrent] = useState<IncidentCurrentData | null>(null);
    const [routing, setRouting] = useState<ModelRoutingTelemetry | null>(null);
    const [reliability, setReliability] = useState<ReliabilityData | null>(null);

    const clientRef = useRef<WsClient | null>(null);

    useEffect(() => {
        // Skip if no token configured — fall back to polling
        if (!WS_TOKEN) return;

        const client = new WsClient({
            token: WS_TOKEN,
            topics: [...SUBSCRIBED_TOPICS],
        });
        clientRef.current = client;

        client.onStateChange = (state) => {
            setConnectionState(state);
            setRetryCount(client.retryCount);
            if (client.lastError) setLastError(client.lastError);
        };

        client.onSnapshot = (snapshot: WsSnapshotPayload) => {
            applySnapshot(snapshot, { setIncidentsCurrent, setRouting, setReliability });
        };

        client.onEvent = (envelope: WsEventEnvelope) => {
            applyEvent(envelope, { setIncidentsCurrent, setRouting, setReliability });
        };

        client.connect();

        return () => {
            client.close();
            clientRef.current = null;
        };
    }, []);

    return { connectionState, retryCount, lastError, incidentsCurrent, routing, reliability };
}

// ── Payload Applicators ────────────────────────────────────────────────────────

interface ApplyDeps {
    setIncidentsCurrent: React.Dispatch<React.SetStateAction<IncidentCurrentData | null>>;
    setRouting: React.Dispatch<React.SetStateAction<ModelRoutingTelemetry | null>>;
    setReliability: React.Dispatch<React.SetStateAction<ReliabilityData | null>>;
}

function applySnapshot(snapshot: WsSnapshotPayload, deps: ApplyDeps): void {
    if (snapshot.incidents) {
        deps.setIncidentsCurrent(snapshot.incidents as IncidentCurrentData);
    }
    if (snapshot.routing) {
        deps.setRouting(snapshot.routing as ModelRoutingTelemetry);
    }
    if (snapshot.reliability) {
        deps.setReliability(snapshot.reliability as ReliabilityData);
    }
}

function applyEvent(envelope: WsEventEnvelope, deps: ApplyDeps): void {
    switch (envelope.topic) {
        case 'incidents':
            deps.setIncidentsCurrent(envelope.payload as IncidentCurrentData);
            break;
        case 'routing':
            deps.setRouting(envelope.payload as ModelRoutingTelemetry);
            break;
        case 'reliability':
            deps.setReliability(envelope.payload as ReliabilityData);
            break;
        default:
            break;
    }
}
