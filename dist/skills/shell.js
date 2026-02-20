import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logSystemCommand, scrubSensitiveText } from '../utils/logger.js';
const execAsync = promisify(exec);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_LENGTH = 8_000;
function truncateOutput(output) {
    if (output.length <= MAX_OUTPUT_LENGTH) {
        return output;
    }
    return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n...[truncated]`;
}
export async function executeShell(command, cwd) {
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: DEFAULT_TIMEOUT_MS,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        });
        const mergedOutput = truncateOutput(scrubSensitiveText(`${stdout}${stderr}`.trim()));
        await logSystemCommand(command, mergedOutput || '(no output)', 0);
        return {
            ok: true,
            output: mergedOutput,
            exitCode: 0,
        };
    }
    catch (error) {
        const err = error;
        const mergedOutput = truncateOutput(scrubSensitiveText(`${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`.trim()));
        const exitCode = typeof err.code === 'number' ? err.code : 1;
        await logSystemCommand(command, mergedOutput || '(no output)', exitCode);
        return {
            ok: false,
            output: mergedOutput,
            exitCode,
        };
    }
}
