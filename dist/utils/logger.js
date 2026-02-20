import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
function currentDateIso() {
    return new Date().toISOString().slice(0, 10);
}
function nowIso() {
    return new Date().toISOString();
}
function transcriptPath(dateIso) {
    return path.resolve('memory', `${dateIso}.md`);
}
async function ensureTranscriptDir() {
    await mkdir(path.resolve('memory'), { recursive: true });
}
export function scrubSensitiveText(raw) {
    let sanitized = raw;
    sanitized = sanitized.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s\n]+/gi, '$1=[REDACTED]');
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g, '[REDACTED_JWT]');
    return sanitized;
}
async function appendSection(title, body) {
    await ensureTranscriptDir();
    const line = `\n## ${title} @ ${nowIso()}\n\n${body}\n`;
    await appendFile(transcriptPath(currentDateIso()), line, 'utf8');
}
export async function logThought(note) {
    await appendSection('Thought', scrubSensitiveText(note));
}
export async function logToolCall(toolName, args, result) {
    const payload = [
        `- Tool: ${toolName}`,
        `- Args: ${scrubSensitiveText(JSON.stringify(args))}`,
        `- Result: ${scrubSensitiveText(result)}`,
    ].join('\n');
    await appendSection('Tool Call', payload);
}
export async function logSystemCommand(command, output, exitCode) {
    const payload = [
        `- Command: ${scrubSensitiveText(command)}`,
        `- ExitCode: ${exitCode}`,
        `- Output:`,
        '```text',
        scrubSensitiveText(output),
        '```',
    ].join('\n');
    await appendSection('System Command', payload);
}
