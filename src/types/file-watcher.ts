/** Types of filesystem changes the watcher emits. */
export type FileEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

/** Normalized filesystem event payload. */
export interface FileEvent {
    type: FileEventType;
    /** Absolute path of the affected file or directory. */
    path: string;
    /** ISO-8601 timestamp when the event was detected. */
    timestamp: string;
}

/** Callback invoked when a watched filesystem event occurs. */
export type FileEventListener = (event: FileEvent) => Promise<void> | void;

/** Configuration for a watched directory entry. */
export interface WatchTarget {
    /** Unique label for this watch (e.g. 'workspace', 'identity'). */
    id: string;
    /** Absolute path to the directory to monitor. */
    directory: string;
    /** Glob patterns to include. If omitted, all files are watched. */
    include?: string[];
    /** Glob patterns to exclude (e.g. 'node_modules/**'). */
    exclude?: string[];
}
