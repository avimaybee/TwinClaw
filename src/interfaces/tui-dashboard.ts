import blessed from 'blessed';
import contrib from 'blessed-contrib';

// Capture native logs so we can pipe them to the dashboard log view
const nativeLog = console.log;
const nativeError = console.error;

export function startTUI() {
    const screen = blessed.screen({ smartCSR: true });
    screen.title = 'TwinClaw Native Dashboard';

    const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

    const logView = grid.set(0, 0, 8, 8, contrib.log, {
        fg: "green",
        selectedFg: "green",
        label: ' Live System Logs '
    });

    const memoryDonut = grid.set(0, 8, 4, 4, contrib.donut, {
        label: ' System Memory ',
        radius: 12,
        arcWidth: 4,
        yPadding: 2
    });

    const providerView = grid.set(4, 8, 4, 4, contrib.markdown, {
        label: ' Active Provider '
    });

    const statusView = grid.set(8, 0, 4, 12, contrib.markdown, {
        label: ' TwinClaw Status '
    });

    // Replace console defaults
    console.log = (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        logView.log(text);
        screen.render();
    };

    console.error = (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        logView.log(`{red-fg}[ERROR]{/red-fg} ${text}`);
        screen.render();
    };

    setInterval(() => {
        const mem = process.memoryUsage();
        const percent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

        memoryDonut.update([
            { percent: percent, label: 'Heap', color: 'blue' }
        ]);

        providerView.setMarkdown(`**Current Target:**\nOpenRouter (Claude 3.5 Sonnet)\n\n**Fallback Chains:**\n1. Google AI Studio\n2. Modal Serverless\n\n**Status:** Online 🟢`);

        statusView.setMarkdown(`TwinClaw Autonomous Service running.\nMemory: Local SQLite + sqlite-vec.\nBackground Job Engine: Active.\n\nPress **Escape**, **q**, or **C-c** to quit.`);

        screen.render();
    }, 1000);

    screen.key(['escape', 'q', 'C-c'], () => {
        return process.exit(0);
    });

    console.log('TUI Initialized. Monitoring agent activities...');
    screen.render();
}
