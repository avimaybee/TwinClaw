import type { Request, Response } from 'express';
import type { HealthData } from '../../types/api.js';
import type { SkillRegistry } from '../../services/skill-registry.js';
import type { McpServerManager } from '../../services/mcp-server-manager.js';
import type { HeartbeatService } from '../../core/heartbeat.js';
import { sendOk } from '../shared.js';

const startTime = Date.now();

export interface HealthDeps {
    heartbeat: HeartbeatService;
    skillRegistry: SkillRegistry;
    mcpManager: McpServerManager;
}

/** GET /health — Returns system health status and subsystem summaries. */
export function handleHealth(deps: HealthDeps) {
    return (_req: Request, res: Response): void => {
        const summary = deps.skillRegistry.summary();
        const servers = deps.mcpManager.listServers();
        const heartbeatRunning = deps.heartbeat.scheduler
            .listJobs()
            .some((j) => j.status === 'running');

        const data: HealthData = {
            status: servers.some((s) => s.state === 'error') ? 'degraded' : 'ok',
            uptime: Math.floor((Date.now() - startTime) / 1000),
            heartbeat: { running: heartbeatRunning },
            skills: {
                builtin: summary.builtin ?? 0,
                mcp: summary.mcp ?? 0,
                total: deps.skillRegistry.size,
            },
            mcpServers: servers.map((s) => ({
                id: s.id,
                name: s.name,
                state: s.state,
                toolCount: s.toolCount,
            })),
        };

        sendOk(res, data);
    };
}
