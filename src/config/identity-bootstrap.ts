import * as fs from 'fs';
import * as path from 'path';
import { getIdentityDir, getWorkspaceSubdir } from './workspace.js';

const DEFAULT_SOUL_TEMPLATE = `# TwinClaw Core Directives

## Operational Tone
- Be direct, concise, and practical
- Prioritize solving problems over being agreeable
- Ask clarifying questions when instructions are ambiguous

## Behavioral Boundaries
- Never execute commands that could cause irreversible harm to the system
- Always confirm before executing destructive operations
- Maintain user privacy and never log sensitive information

## Core Principles
- Zero-cost infrastructure: Prefer local solutions over paid services
- Local-first: Use local databases and file storage before external services
- Proactive: Anticipate user needs and offer suggestions
- Transparent: Be clear about limitations and uncertainties

## Communication Style
- Use natural, conversational language
- Provide context for important decisions
- Admit when you don't know something
`;

const DEFAULT_IDENTITY_TEMPLATE = `# TwinClaw Identity

## Basic Info
- **Name:** TwinClaw
- **Role:** Local AI Assistant
- **Version:** 1.0.0

## Persona
TwinClaw is a local-first AI assistant that runs on your machine. It has access to your filesystem, can execute commands, and help with various tasks.

## Capabilities
- File system operations
- Command execution
- Web browsing via Playwright
- Messaging via WhatsApp and Telegram
- Long-term memory via semantic search

## Limitations
- Depends on local resources (CPU, memory, disk)
- Requires API keys for cloud AI models
- Cannot access the internet without configured channels
`;

const DEFAULT_MEMORY_TEMPLATE = `# TwinClaw Memory

This file stores long-term facts, preferences, and important information that should persist across sessions.

## User Preferences
- (Add user preferences here)

## Important Facts
- (Add important facts about the user or context here)

## Learned Information
- (Information learned from conversations that should be remembered)
`;

export function ensureIdentityFiles(): void {
    const identityDir = getIdentityDir();
    const memoryDir = getWorkspaceSubdir('memory');

    if (!fs.existsSync(identityDir)) {
        fs.mkdirSync(identityDir, { recursive: true });
    }

    if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
    }

    const soulPath = path.join(identityDir, 'soul.md');
    if (!fs.existsSync(soulPath)) {
        fs.writeFileSync(soulPath, DEFAULT_SOUL_TEMPLATE, { encoding: 'utf-8' });
    }

    const identityPath = path.join(identityDir, 'identity.md');
    if (!fs.existsSync(identityPath)) {
        fs.writeFileSync(identityPath, DEFAULT_IDENTITY_TEMPLATE, { encoding: 'utf-8' });
    }

    const memoryPath = path.join(memoryDir, 'memory.md');
    if (!fs.existsSync(memoryPath)) {
        fs.writeFileSync(memoryPath, DEFAULT_MEMORY_TEMPLATE, { encoding: 'utf-8' });
    }
}

export function getIdentityFilesStatus(): {
    soul: boolean;
    identity: boolean;
    memory: boolean;
} {
    const identityDir = getIdentityDir();
    const memoryDir = getWorkspaceSubdir('memory');

    return {
        soul: fs.existsSync(path.join(identityDir, 'soul.md')),
        identity: fs.existsSync(path.join(identityDir, 'identity.md')),
        memory: fs.existsSync(path.join(memoryDir, 'memory.md')),
    };
}

export const IDENTITY_FILE_CHECKS = [
    {
        kind: 'filesystem' as const,
        name: 'identity-soul',
        description: 'Identity soul.md constitution file',
        severity: 'critical' as const,
        remediation: 'Run `node src/index.ts onboard` to initialize identity files.',
    },
    {
        kind: 'filesystem' as const,
        name: 'identity-identity',
        description: 'Identity persona file',
        severity: 'critical' as const,
        remediation: 'Run `node src/index.ts onboard` to initialize identity files.',
    },
    {
        kind: 'filesystem' as const,
        name: 'identity-memory',
        description: 'Long-term memory file',
        severity: 'warning' as const,
        remediation: 'Run `node src/index.ts onboard` to initialize memory file.',
    },
];
