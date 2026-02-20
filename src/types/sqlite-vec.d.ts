declare module 'sqlite-vec' {
    import { Database } from 'better-sqlite3';
    export function load(db: Database): void;
    export function serializeFloat32(value: number[]): Uint8Array;
}
