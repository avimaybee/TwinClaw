export type IncidentType =
  | 'queue_backpressure'
  | 'callback_failure_storm'
  | 'context_budget_degradation'
  | 'model_routing_instability';

export type IncidentSeverity = 'warning' | 'critical';

export type IncidentStatus = 'active' | 'remediating' | 'escalated' | 'resolved';

export type IncidentRemediationAction =
  | 'none'
  | 'throttle'
  | 'drain'
  | 'failover'
  | 'retry_window_adjustment'
  | 'halt_safe_mode';

export interface IncidentEvidence {
  signal: string;
  observedValue: number;
  threshold: number;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface IncidentRecord {
  id: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  summary: string;
  evidence: IncidentEvidence[];
  remediationAction: IncidentRemediationAction;
  remediationAttempts: number;
  cooldownUntil: string | null;
  escalated: boolean;
  recommendedActions: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface IncidentTimelineEntry {
  id: string;
  incidentId: string;
  incidentType: IncidentType;
  eventType: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface CallbackOutcomeCounts {
  accepted: number;
  duplicate: number;
  rejected: number;
}
