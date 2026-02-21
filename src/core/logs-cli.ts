import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';

function currentDateIso(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Handle the `logs` command.
 * Reads or tails the daily TwinClaw memory log file.
 */
export async function handleLogsCli(argv: string[]): Promise<boolean> {
    if (argv[0] !== 'logs') return false;

    const follow = argv.includes('--follow') || argv.includes('-f');
    const dateIso = currentDateIso();
    const logPath = path.resolve('memory', `${dateIso}.md`);

    if (!fs.existsSync(logPath)) {
        console.error(`[TwinClaw Logs] No logs found for today (${dateIso}) at ${logPath}.`);
        process.exitCode = 1;
        return true;
    }

    if (follow) {
        console.log(`[TwinClaw Logs] Following logs from ${logPath}...\n`);
        tailFile(logPath);
        // We do not exit the process here to keep the watcher alive.
    } else {
        const contents = await fsPromises.readFile(logPath, 'utf8');
        process.stdout.write(contents);
        process.exitCode = 0;
    }

    return true;
}

/**
 * Tail a file similar to `tail -f`.
 */
function tailFile(filePath: string) {
    let position = fs.statSync(filePath).size;
    // For tailing, print the last 4KB of context first context
    const startPos = Math.max(0, position - 4096);

    if (startPos < position) {
        const initialStream = fs.createReadStream(filePath, { start: startPos, encoding: 'utf8' });
        initialStream.pipe(process.stdout);
    }

    try {
        fs.watch(filePath, (eventType) => {
            if (eventType === 'change') {
                const stats = fs.statSync(filePath);
                if (stats.size > position) {
                    const stream = fs.createReadStream(filePath, {
                        start: position,
                        end: stats.size,
                        encoding: 'utf8'
                    });

                    stream.on('data', (chunk) => {
                        process.stdout.write(chunk);
                    });

                    position = stats.size;
                } else if (stats.size < position) {
                    // File was truncated or rolled over
                    position = stats.size;
                }
            }
        });
    } catch (err) {
        console.error(`[TwinClaw Logs] Failed to watch file: ${err instanceof Error ? err.message : String(err)}`);
    }
}
