import { useEffect, useState } from 'react';
import { useDashboardData } from './hooks/use-dashboard-data';
import {
  TwinClawApi,
  type ModelRoutingFallbackMode,
  type SystemHealth,
  type ReliabilityData,
  type IncidentCurrentData,
  type IncidentHistoryData,
} from './services/api';
import {
  PersonaEditorController,
  type PersonaDocumentField,
  type PersonaEditorState,
} from './services/persona-editor-controller';

// Using a grid with 1px border lines everywhere for structure.
function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const { health, reliability, logs, incidentsCurrent, incidentHistory, error, lastUpdated, refresh } = useDashboardData();
  const [haltState, setHaltState] = useState<'idle' | 'confirm' | 'halting'>('idle');

  const isOffline = error !== null || health?.status === 'offline';
  const statusColor = isOffline ? 'text-accent' : (health?.status === 'degraded' ? 'text-yellow-600' : 'text-green-500');
  const statusText = isOffline ? 'OFFLINE' : (health?.status === 'degraded' ? 'DEGRADED' : 'ONLINE');

  const handleHaltClick = () => {
    if (haltState === 'idle') {
      setHaltState('confirm');
      setTimeout(() => setHaltState('idle'), 3000);
    } else if (haltState === 'confirm') {
      setHaltState('halting');
      TwinClawApi.haltSystem().catch((err) => {
        console.error('Halt failed:', err);
        setHaltState('idle');
      });
    }
  };

  const handleSetRoutingMode = async (mode: ModelRoutingFallbackMode) => {
    try {
      await TwinClawApi.setRoutingMode(mode);
      await refresh();
    } catch (err) {
      console.error('Routing mode update failed:', err);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <nav className="w-64 border-r border-border flex flex-col pt-4">
        <div className="px-4 pb-4 border-b border-border">
          <h1 className="text-sm font-bold uppercase tracking-widest text-accent">TwinClaw Hub</h1>
          <p className="text-xs text-muted mt-1">Autonomous Agent v1.0.0</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <div className="text-[10px] uppercase text-muted px-4 mb-2 tracking-widest">Modules</div>
          <ul className="space-y-0.5">
            <NavItem label="Overview Dashboard" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
            <NavItem label="System Logs" active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} />
            <NavItem label="Memory Graph" active={activeTab === 'memory'} onClick={() => setActiveTab('memory')} />
            <NavItem label="Identity & State" active={activeTab === 'persona'} onClick={() => setActiveTab('persona')} />
            <NavItem label="Background Jobs" active={activeTab === 'jobs'} onClick={() => setActiveTab('jobs')} />
          </ul>
        </div>

        <div className="p-4 border-t border-border mt-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-muted uppercase tracking-widest">Control Plane</span>
              <span className={`text-xs font-bold mt-1 ${statusColor}`}>[{statusText}]</span>
            </div>
            {lastUpdated && (
              <div className="text-[10px] text-muted text-right">
                <div>Last sync:</div>
                <div>{lastUpdated.toLocaleTimeString()}</div>
              </div>
            )}
          </div>

          <button
            onClick={refresh}
            className="w-full py-1.5 border border-border hover:bg-surface text-[10px] uppercase tracking-widest text-center transition-colors mb-2"
          >
            REFRESH SYNC
          </button>
          <button
            onClick={handleHaltClick}
            disabled={haltState === 'halting'}
            className={`w-full py-1.5 border transition-colors text-[10px] uppercase tracking-widest text-center 
              ${haltState === 'confirm' ? 'border-red-600 bg-red-600/20 text-red-500 hover:bg-red-600/30 font-bold' :
                haltState === 'halting' ? 'border-border text-muted opacity-50 cursor-not-allowed' :
                  'border-accent/50 text-accent hover:bg-accent/10'}`}
          >
            {haltState === 'confirm' ? 'CONFIRM HALT' : haltState === 'halting' ? 'HALTING...' : 'HALT AGENT'}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-background relative z-0">
        {/* Top Bar for specific pane info */}
        <header className="h-14 border-b border-border flex items-center px-6 justify-between shrink-0 relative z-10 bg-background/50 backdrop-blur-none">
          <div className="flex items-center space-x-4">
            <h2 className="text-sm font-semibold capitalize tracking-wider">{activeTab.replace('-', ' ')}</h2>
            {error && (
              <span className="px-2 py-0.5 bg-accent/20 text-accent text-[10px] uppercase tracking-widest border border-accent/50">
                Connection Error
              </span>
            )}
            {haltState === 'halting' && (
              <span className="px-2 py-0.5 bg-red-600/20 text-red-500 text-[10px] uppercase tracking-widest border border-red-500/50">
                Graceful Shutdown Initiated
              </span>
            )}
          </div>

          <div className="text-[10px] text-muted flex space-x-6 uppercase tracking-widest">
            <div className="flex flex-col items-end">
              <span>Memory</span>
              <span className="text-foreground">{health ? `${health.memoryUsageMb} MB` : '---'}</span>
            </div>
            <div className="flex flex-col items-end">
              <span>Uptime</span>
              <span className="text-foreground">
                {health ? new Date(health.uptimeSec * 1000).toISOString().substr(11, 8) : '--:--:--'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span>Skills (BLT/MCP)</span>
              <span className="text-foreground">
                {health ? `${health.skills.builtin} / ${health.skills.mcp}` : '- / -'}
              </span>
            </div>
          </div>
        </header>

        {/* Content Pane */}
        <div className="flex-1 overflow-auto p-0 relative">
          <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: 'linear-gradient(to right, #3e3833 1px, transparent 1px), linear-gradient(to bottom, #3e3833 1px, transparent 1px)', backgroundSize: '64px 64px', opacity: 0.1 }}></div>

          {error && (
            <div className="absolute top-0 left-0 right-0 bg-accent/10 border-b border-accent/50 p-2 z-20">
              <p className="text-xs text-accent font-mono text-center">Backend Unavailable: {error}</p>
            </div>
          )}

          <div className={`h-full relative z-10 ${error ? 'opacity-50 pointer-events-none' : ''}`}>
            {activeTab === 'overview' && (
              <OverviewPane
                health={health}
                reliability={reliability}
                incidentsCurrent={incidentsCurrent}
                incidentHistory={incidentHistory}
                onSetRoutingMode={handleSetRoutingMode}
              />
            )}
            {activeTab === 'logs' && <LogViewer logs={logs} />}
            {activeTab === 'persona' && <PersonaEditor />}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left px-4 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${active ? 'bg-surface border-l-2 border-accent text-foreground' : 'text-muted hover:text-foreground border-l-2 border-transparent'}`}
      >
        {label}
      </button>
    </li>
  );
}

function OverviewPane({
  health,
  reliability,
  incidentsCurrent,
  incidentHistory,
}: {
  health: SystemHealth | null,
  reliability: ReliabilityData | null,
  incidentsCurrent: IncidentCurrentData | null,
  incidentHistory: IncidentHistoryData | null,
  onSetRoutingMode: (mode: ModelRoutingFallbackMode) => Promise<void>
}) {
  if (!health) return null;

  const activeIncidents = incidentsCurrent?.incidents ?? [];
  const escalatedCount = activeIncidents.filter((incident) => incident.status === 'escalated').length;
  const latestTimelineEvent = incidentHistory?.timeline?.[0] ?? null;
  const routing = health.routing ?? null;

  return (
    <div className="p-6 grid grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min">
      <Section title="System Core status">
        <DataRow label="Agent Name" value="TwinClaw v1" />
        <DataRow label="Operational State" value={health.status} valueColor={health.status === 'ok' ? 'text-green-500' : 'text-yellow-500'} />
        <DataRow label="Uptime Duration" value={`${Math.floor(health.uptimeSec / 60)} minutes`} />
        <DataRow label="Memory Footprint" value={`${health.memoryUsageMb} MB RSS`} />
        <DataRow label="Heartbeat Trigger" value={health.heartbeat.running ? 'Active (Tick-based)' : 'Idle'} />
      </Section>

      <Section title="Capability Fabric">
        <DataRow label="Built-in Skills" value={health.skills.builtin.toString()} />
        <DataRow label="MCP Connections" value={health.skills.mcp.toString()} />
        <DataRow label="Total Actions" value={health.skills.total.toString()} />
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="text-[10px] text-muted uppercase tracking-widest mb-2">Connected MCP Servers</div>
          {health.mcpServers.length === 0 ? (
            <div className="text-xs text-muted">No external servers initialized.</div>
          ) : (
            <div className="space-y-1">
              {health.mcpServers.map((s) => (
                <div key={s.id} className="text-xs flex justify-between">
                  <span className="text-foreground">{s.name} ({s.toolCount} tools)</span>
                  <span className={s.state === 'running' ? 'text-green-500' : 'text-accent'}>[{s.state}]</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Delivery Reliability Metrics">
        {!reliability ? (
          <div className="text-xs text-muted">Awaiting metrics propagation...</div>
        ) : (
          <>
            <div className="text-[10px] text-muted uppercase tracking-widest mb-2">Persistent Delivery Queue</div>
            <DataRow label="Total Dispatched" value={reliability.queue?.totalSent.toString() ?? '0'} />
            <DataRow label="Retry Failures" value={reliability.queue?.totalFailed.toString() ?? '0'} valueColor={((reliability.queue?.totalFailed ?? 0) > 0) ? 'text-accent' : undefined} />
            <DataRow label="Dead Letters" value={reliability.queue?.totalDeadLetters.toString() ?? '0'} valueColor={((reliability.queue?.totalDeadLetters ?? 0) > 0) ? 'text-red-500 font-bold' : undefined} />

            <div className="mt-4 pt-4 border-t border-border/50">
              <div className="text-[10px] text-muted uppercase tracking-widest mb-2">Inbound Callbacks</div>
              <DataRow label="Accepted Task Receipts" value={reliability.callbacks?.totalAccepted.toString() ?? '0'} />
              <DataRow label="Duplicate Suppressed" value={reliability.callbacks?.totalDuplicate.toString() ?? '0'} />
              <DataRow label="Rejected Attempts" value={reliability.callbacks?.totalRejected.toString() ?? '0'} valueColor={((reliability.callbacks?.totalRejected ?? 0) > 0) ? 'text-accent' : undefined} />
            </div>
          </>
        )}
      </Section>

      <Section title="Model Routing Telemetry">
        {!routing ? (
          <div className="text-xs text-muted">Routing telemetry not available.</div>
        ) : (
          <>
            <DataRow label="Fallback Mode" value={routing.fallbackMode} />
            <DataRow label="Current Model" value={routing.currentModelId ?? 'none'} />
            <DataRow label="Consecutive Failures" value={routing.consecutiveFailures.toString()} valueColor={routing.consecutiveFailures > 0 ? 'text-yellow-500' : undefined} />
            <DataRow label="Failovers" value={routing.failoverCount.toString()} />
            <DataRow
              label="Active Cooldowns"
              value={routing.activeCooldowns.length.toString()}
              valueColor={routing.activeCooldowns.length > 0 ? 'text-yellow-500' : undefined}
            />
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Operator Guidance</div>
              <div className="text-xs text-foreground">{routing.operatorGuidance[0] ?? 'No guidance available.'}</div>
            </div>
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="text-[10px] text-muted uppercase tracking-widest mb-2">Fallback Mode Control</div>
              <div className="flex gap-2">
                <button
                  onClick={() => void onSetRoutingMode('intelligent_pacing')}
                  disabled={routing.fallbackMode === 'intelligent_pacing'}
                  className="px-2 py-1 border border-border text-[10px] uppercase tracking-widest disabled:opacity-40"
                >
                  Intelligent
                </button>
                <button
                  onClick={() => void onSetRoutingMode('aggressive_fallback')}
                  disabled={routing.fallbackMode === 'aggressive_fallback'}
                  className="px-2 py-1 border border-border text-[10px] uppercase tracking-widest disabled:opacity-40"
                >
                  Aggressive
                </button>
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title="Incident Self-Healing">
        {!incidentsCurrent ? (
          <div className="text-xs text-muted">Awaiting incident telemetry...</div>
        ) : (
          <>
            <DataRow
              label="Safe Mode"
              value={incidentsCurrent.safeMode ? 'enabled' : 'disabled'}
              valueColor={incidentsCurrent.safeMode ? 'text-red-500 font-bold' : undefined}
            />
            <DataRow
              label="Active Incidents"
              value={activeIncidents.length.toString()}
              valueColor={activeIncidents.length > 0 ? 'text-yellow-500' : undefined}
            />
            <DataRow
              label="Escalated"
              value={escalatedCount.toString()}
              valueColor={escalatedCount > 0 ? 'text-red-500 font-bold' : undefined}
            />
            <DataRow
              label="History Entries"
              value={(incidentHistory?.timeline.length ?? 0).toString()}
            />
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Current Incident Details</div>
              {activeIncidents.length === 0 ? (
                <div className="text-xs text-muted">No active incidents detected.</div>
              ) : (
                <div className="space-y-1">
                  {activeIncidents.slice(0, 3).map((incident) => (
                    <div key={incident.id} className="text-xs flex justify-between gap-2">
                      <span className="text-foreground font-mono">{incident.incidentType}</span>
                      <span className={incident.status === 'escalated' ? 'text-red-500' : 'text-yellow-500'}>
                        {incident.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {latestTimelineEvent && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Latest Timeline Event</div>
                <div className="text-xs text-foreground font-mono">
                  {latestTimelineEvent.eventType} · {latestTimelineEvent.incidentType}
                </div>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <section className="border border-border bg-surface/30 p-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted mb-4 pb-2 border-b border-border/50">{title}</h3>
      <div className="space-y-2">
        {children}
      </div>
    </section>
  );
}

function DataRow({ label, value, valueColor = 'text-foreground' }: { label: string, value: string, valueColor?: string }) {
  return (
    <div className="flex justify-between items-baseline border-b border-border/20 pb-1">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`text-xs font-mono uppercase ${valueColor}`}>{value}</span>
    </div>
  );
}


function LogViewer({ logs }: { logs: any[] }) {
  return (
    <div className="p-6">
      <table className="w-full text-xs text-left">
        <thead className="border-b border-border/50 text-muted">
          <tr>
            <th className="font-normal py-2 w-32 whitespace-nowrap">Timestamp</th>
            <th className="font-normal py-2 w-24">Indicator</th>
            <th className="font-normal py-2">Payload</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {logs.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-8 text-center text-muted italic">No log entries captured today.</td>
            </tr>
          ) : (
            logs.map((entry, idx) => (
              <LogEntryRow key={idx} time={entry.timestamp} level={entry.level} message={entry.message} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function LogEntryRow({ time, level, message }: { time: string, level: string, message: string }) {
  const getLevelColor = (l: string) => {
    const s = l.toUpperCase();
    if (s.includes('WARN')) return 'text-accent';
    if (s.includes('ERROR')) return 'text-red-500';
    if (s.includes('LLM')) return 'text-blue-400';
    if (s.includes('TOOL')) return 'text-purple-400';
    if (s.includes('THOUGHT')) return 'text-cyan-400';
    return 'text-muted';
  }

  // Extract the time from ISO string if possible
  const displayTime = time.includes('T') ? time.split('T')[1].slice(0, 12) : time;

  return (
    <tr className="hover:bg-surface/50 transition-colors">
      <td className="py-2 text-muted whitespace-nowrap align-top font-mono">{displayTime}</td>
      <td className={`py-2 whitespace-nowrap align-top font-bold ${getLevelColor(level)}`}>[{level}]</td>
      <td className="py-2 text-foreground align-top whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{message}</td>
    </tr>
  );
}

function PersonaEditor() {
  const [controller] = useState(() => new PersonaEditorController());
  const [state, setState] = useState<PersonaEditorState>(() => controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.load();
    return () => {
      unsubscribe();
    };
  }, [controller]);

  const bindField = (field: PersonaDocumentField) => (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    controller.updateField(field, event.target.value);
  };

  const isSaveDisabled = state.isLoading || state.isSaving || !state.dirty;

  return (
    <div className="flex flex-col h-full border-l border-border/50 relative z-10">
      <div className="p-6 border-b border-border/50 flex items-start justify-between gap-4">
        <div>
        <h3 className="text-sm">Identity Rules Engine</h3>
          <p className="text-xs text-muted mt-2">
            Edit `soul.md`, `identity.md`, and `user.md` directly from the control plane.
          </p>
          {state.updatedAt && (
            <p className="text-[10px] text-muted mt-2 uppercase tracking-widest">
              Last synced: {new Date(state.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void controller.load()}
            disabled={state.isLoading || state.isSaving}
            className="min-h-11 px-3 border border-border text-[10px] uppercase tracking-widest hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.isLoading ? 'Loading...' : 'Reload'}
          </button>
          <button
            onClick={() => void controller.save()}
            disabled={isSaveDisabled}
            className="min-h-11 px-3 border border-accent/50 text-accent text-[10px] uppercase tracking-widest hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="p-4 border-b border-border/50 min-h-16">
        {state.error ? (
          <div className="text-xs text-red-500 font-mono">
            {state.error}
          </div>
        ) : state.saveMessage ? (
          <div className="text-xs text-green-500 font-mono">
            {state.saveMessage}
          </div>
        ) : (
          <div className="text-xs text-muted">
            {state.dirty ? 'Unsaved local edits.' : 'No pending persona edits.'}
          </div>
        )}
        {state.hints.length > 0 && (
          <ul className="mt-2 text-[11px] text-muted space-y-1">
            {state.hints.map((hint) => (
              <li key={hint}>- {hint}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 gap-4 p-4 overflow-auto">
        <div className="flex flex-col border border-border p-3 bg-background">
          <label className="text-[10px] text-muted uppercase tracking-widest mb-2">Soul (identity/soul.md)</label>
          <textarea
            className="flex-1 w-full bg-transparent border border-border/50 text-xs text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-accent resize-none leading-relaxed p-2"
            value={state.soul}
            onChange={bindField('soul')}
            spellCheck="false"
          />
        </div>
        <div className="flex flex-col border border-border p-3 bg-background">
          <label className="text-[10px] text-muted uppercase tracking-widest mb-2">Identity (identity/identity.md)</label>
          <textarea
            className="flex-1 w-full bg-transparent border border-border/50 text-xs text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-accent resize-none leading-relaxed p-2"
            value={state.identity}
            onChange={bindField('identity')}
            spellCheck="false"
          />
        </div>
        <div className="flex flex-col border border-border p-3 bg-background">
          <label className="text-[10px] text-muted uppercase tracking-widest mb-2">User (identity/user.md)</label>
          <textarea
            className="flex-1 w-full bg-transparent border border-border/50 text-xs text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-accent resize-none leading-relaxed p-2"
            value={state.user}
            onChange={bindField('user')}
            spellCheck="false"
          />
        </div>
      </div>
    </div>
  );
}

export default App;
