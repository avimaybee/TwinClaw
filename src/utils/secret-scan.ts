import fs from 'node:fs';
import path from 'node:path';

type Severity = 'high' | 'medium';

interface SecretPattern {
  name: string;
  severity: Severity;
  expression: RegExp;
}

interface ScanHit {
  file: string;
  line: number;
  pattern: string;
  severity: Severity;
  preview: string;
}

const SCAN_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.cjs',
  '.mjs',
  '.json',
  '.md',
  '.yaml',
  '.yml',
  '.env',
  '.txt',
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  '.git',
  '.github\\workflows\\node_modules',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.vite',
  '.turbo',
  'memory',
]);

const IGNORED_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const PLACEHOLDER_MARKERS = [
  '<YOUR_',
  '<REDACTED',
  'YOUR_API_KEY',
  'YOUR_TOKEN',
  'EXAMPLE_',
  'TEST_',
  'DUMMY_',
  'PLACEHOLDER',
];

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    name: 'OpenRouter API key',
    severity: 'high',
    expression: /\bsk-or-v1-[A-Za-z0-9]{32,}\b/g,
  },
  {
    name: 'Telegram bot token',
    severity: 'high',
    expression: /\b\d{8,10}:[A-Za-z0-9_-]{35,}\b/g,
  },
  {
    name: 'Google API key',
    severity: 'high',
    expression: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: 'GitHub personal access token',
    severity: 'high',
    expression: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    name: 'AWS access key ID',
    severity: 'high',
    expression: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'Private key block',
    severity: 'high',
    expression: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
  },
  {
    name: 'Suspicious key assignment',
    severity: 'medium',
    expression: /\b(api[_-]?key|token|secret)\b\s*[:=]\s*["'][A-Za-z0-9._-]{20,}["']/gi,
  },
];

function toRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function isExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  if (IGNORED_FILE_NAMES.has(path.basename(normalized))) {
    return true;
  }

  for (const segment of EXCLUDED_PATH_SEGMENTS) {
    const normalizedSegment = segment.replace(/\\/g, '/').toLowerCase();
    if (
      normalized === normalizedSegment ||
      normalized.startsWith(`${normalizedSegment}/`) ||
      normalized.includes(`/${normalizedSegment}/`)
    ) {
      return true;
    }
  }
  return false;
}

function shouldScanFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return SCAN_FILE_EXTENSIONS.has(extension) || path.basename(filePath).startsWith('.env');
}

function hasPlaceholderMarker(value: string): boolean {
  const upper = value.toUpperCase();
  return PLACEHOLDER_MARKERS.some((marker) => upper.includes(marker));
}

function isIntentionalExample(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) {
    return true;
  }
  if (trimmed.includes('example.com')) {
    return true;
  }
  if (trimmed.includes('REDACTED') || trimmed.includes('redacted')) {
    return true;
  }
  if (hasPlaceholderMarker(trimmed)) {
    return true;
  }
  return false;
}

function maskMatch(value: string): string {
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function scanFile(filePath: string, rootDir: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const relativePath = toRelativePath(rootDir, filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (isIntentionalExample(line)) {
      return;
    }

    for (const pattern of SECRET_PATTERNS) {
      pattern.expression.lastIndex = 0;
      for (const match of line.matchAll(pattern.expression)) {
        const matched = match[0];
        if (!matched) {
          continue;
        }
        if (hasPlaceholderMarker(matched)) {
          continue;
        }
        hits.push({
          file: relativePath,
          line: index + 1,
          pattern: pattern.name,
          severity: pattern.severity,
          preview: maskMatch(matched),
        });
      }
    }
  });

  return hits;
}

function walkDirectory(rootDir: string, currentDir: string, hits: ScanHit[]): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = toRelativePath(rootDir, fullPath);

    if (isExcludedPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walkDirectory(rootDir, fullPath, hits);
      continue;
    }

    if (!entry.isFile() || !shouldScanFile(fullPath)) {
      continue;
    }

    hits.push(...scanFile(fullPath, rootDir));
  }
}

export interface SecretScanSummary {
  high: ScanHit[];
  medium: ScanHit[];
  passed: boolean;
}

export function runSecretScan(rootDir: string = process.cwd()): SecretScanSummary {
  const absoluteRoot = path.resolve(rootDir);
  const hits: ScanHit[] = [];
  walkDirectory(absoluteRoot, absoluteRoot, hits);

  const high = hits.filter((hit) => hit.severity === 'high');
  const medium = hits.filter((hit) => hit.severity === 'medium');
  const passed = high.length === 0;

  if (high.length === 0 && medium.length === 0) {
    console.log('Secret scan passed: no suspicious credentials detected.');
    return { high, medium, passed };
  }

  if (high.length > 0) {
    console.error('High-severity secret findings detected:');
    for (const hit of high) {
      console.error(`  [HIGH] ${hit.file}:${hit.line} ${hit.pattern} (${hit.preview})`);
    }
  }

  if (medium.length > 0) {
    console.warn('Medium-severity secret findings detected:');
    for (const hit of medium) {
      console.warn(`  [MEDIUM] ${hit.file}:${hit.line} ${hit.pattern} (${hit.preview})`);
    }
  }

  return { high, medium, passed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArg = process.argv[2] ?? process.cwd();
  const result = runSecretScan(rootArg);
  process.exit(result.passed ? 0 : 1);
}
