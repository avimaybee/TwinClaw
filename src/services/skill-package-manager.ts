import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpCapabilityScope, McpServerConfig } from '../types/mcp.js';
import type {
  SkillPackageActivationPlan,
  SkillPackageCatalog,
  SkillPackageDiagnostics,
  SkillPackageLockEntry,
  SkillPackageLockfile,
  SkillPackageManifest,
  SkillPackageMutationResult,
  SkillPackageViolation,
  SkillPackageViolationCode,
} from '../types/skill-packages.js';

const DEFAULT_CATALOG_PATH = path.resolve('skill-packages.json');
const DEFAULT_LOCK_PATH = path.resolve('skill-packages.lock.json');
const LOCKFILE_VERSION = 1;
const DEFAULT_RUNTIME_API_VERSION = '1.0.0';
const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const CAPABILITY_SCOPES: ReadonlySet<McpCapabilityScope> = new Set([
  'read-only',
  'write-limited',
  'high-risk',
  'unclassified',
]);

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

interface SkillPackageManagerOptions {
  catalogPath?: string;
  lockPath?: string;
  runtimeApiVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid manifest field '${fieldName}'. Expected non-empty string.`);
  }
  return value.trim();
}

function parseSemver(version: string): ParsedSemver | null {
  const normalized = version.trim().replace(/^v/, '');
  const match = SEMVER_REGEX.exec(normalized);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) {
    throw new Error(`Cannot compare invalid semver values '${left}' and '${right}'.`);
  }

  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function sortedRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, T>;
}

function normalizeRange(range: string): string {
  return range.trim();
}

function parseRangeBase(rangeValue: string): ParsedSemver {
  const parsed = parseSemver(rangeValue);
  if (!parsed) {
    throw new Error(`Invalid semver range token '${rangeValue}'.`);
  }
  return parsed;
}

function compareParsedVersion(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function satisfiesToken(version: ParsedSemver, token: string): boolean {
  if (token === '*' || token.length === 0) {
    return true;
  }

  const operators = ['>=', '<=', '>', '<', '='];
  for (const operator of operators) {
    if (token.startsWith(operator)) {
      const parsed = parseRangeBase(token.slice(operator.length));
      const comparison = compareParsedVersion(version, parsed);
      switch (operator) {
        case '>=':
          return comparison >= 0;
        case '<=':
          return comparison <= 0;
        case '>':
          return comparison > 0;
        case '<':
          return comparison < 0;
        case '=':
          return comparison === 0;
        default:
          return false;
      }
    }
  }

  if (token.startsWith('^')) {
    const base = parseRangeBase(token.slice(1));
    if (compareParsedVersion(version, base) < 0) return false;

    if (base.major > 0) {
      return version.major === base.major;
    }
    if (base.minor > 0) {
      return version.major === 0 && version.minor === base.minor;
    }
    return version.major === 0 && version.minor === 0 && version.patch === base.patch;
  }

  if (token.startsWith('~')) {
    const base = parseRangeBase(token.slice(1));
    if (compareParsedVersion(version, base) < 0) return false;
    return version.major === base.major && version.minor === base.minor;
  }

  const exact = parseRangeBase(token);
  return compareParsedVersion(version, exact) === 0;
}

function satisfiesRange(version: string, range: string): boolean {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) {
    return false;
  }

  const normalized = normalizeRange(range);
  if (normalized.length === 0 || normalized === '*') {
    return true;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.every((token) => satisfiesToken(parsedVersion, token));
}

function cloneConstraintMap(
  source: Map<string, string[]>,
): Map<string, string[]> {
  const target = new Map<string, string[]>();
  for (const [name, ranges] of source) {
    target.set(name, [...ranges]);
  }
  return target;
}

function addConstraint(
  constraints: Map<string, string[]>,
  packageName: string,
  range: string,
): void {
  const normalizedRange = normalizeRange(range);
  const current = constraints.get(packageName) ?? [];
  if (!current.includes(normalizedRange)) {
    current.push(normalizedRange);
    constraints.set(packageName, current);
  }
}

function expandConstraintsWithDependencies(
  constraints: Map<string, string[]>,
  selected: Map<string, SkillPackageManifest>,
): Map<string, string[]> {
  const expanded = cloneConstraintMap(constraints);
  const selectedEntries = [...selected.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, manifest] of selectedEntries) {
    const dependencies = manifest.dependencies ?? {};
    for (const dependencyName of Object.keys(dependencies).sort()) {
      const dependencyRange = dependencies[dependencyName];
      if (typeof dependencyRange === 'string' && dependencyRange.trim().length > 0) {
        addConstraint(expanded, dependencyName, dependencyRange);
      }
    }
  }
  return expanded;
}

function buildManifestIndex(
  manifests: SkillPackageManifest[],
): Map<string, SkillPackageManifest[]> {
  const index = new Map<string, SkillPackageManifest[]>();
  for (const manifest of manifests) {
    const bucket = index.get(manifest.name) ?? [];
    bucket.push(manifest);
    index.set(manifest.name, bucket);
  }

  for (const [name, bucket] of index) {
    bucket.sort((a, b) => compareSemver(b.version, a.version));
    index.set(name, bucket);
  }

  return index;
}

function findSolverConflict(
  constraints: Map<string, string[]>,
  manifestIndex: Map<string, SkillPackageManifest[]>,
): { packageName: string; ranges: string[]; available: string[] } | null {
  for (const packageName of [...constraints.keys()].sort()) {
    const ranges = constraints.get(packageName) ?? [];
    const candidates = manifestIndex.get(packageName) ?? [];
    const available = candidates.map((candidate) => candidate.version);
    const satisfiable = candidates.some((candidate) =>
      ranges.every((range) => satisfiesRange(candidate.version, range)),
    );
    if (!satisfiable) {
      return { packageName, ranges, available };
    }
  }
  return null;
}

function solveSelection(
  manifestIndex: Map<string, SkillPackageManifest[]>,
  constraints: Map<string, string[]>,
  selected: Map<string, SkillPackageManifest>,
): Map<string, SkillPackageManifest> | null {
  const expanded = expandConstraintsWithDependencies(constraints, selected);

  for (const [packageName, manifest] of selected) {
    const ranges = expanded.get(packageName) ?? [];
    if (!ranges.every((range) => satisfiesRange(manifest.version, range))) {
      return null;
    }
  }

  const unresolved = [...expanded.keys()]
    .filter((packageName) => !selected.has(packageName))
    .sort();
  if (unresolved.length === 0) {
    return selected;
  }

  const nextPackage = unresolved[0];
  if (!nextPackage) {
    return selected;
  }

  const ranges = expanded.get(nextPackage) ?? [];
  const candidates = (manifestIndex.get(nextPackage) ?? []).filter((candidate) =>
    ranges.every((range) => satisfiesRange(candidate.version, range)),
  );

  for (const candidate of candidates) {
    const nextSelected = new Map(selected);
    nextSelected.set(nextPackage, candidate);
    const solved = solveSelection(manifestIndex, expanded, nextSelected);
    if (solved) {
      return solved;
    }
  }

  return null;
}

function parseDependencyMap(
  value: unknown,
  fieldName: string,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid manifest field '${fieldName}'. Expected object map.`);
  }

  const dependencyMap: Record<string, string> = {};
  for (const [dependencyName, dependencyRange] of Object.entries(value)) {
    if (typeof dependencyRange !== 'string' || dependencyRange.trim().length === 0) {
      throw new Error(
        `Invalid dependency range for '${dependencyName}' in '${fieldName}'.`,
      );
    }
    dependencyMap[dependencyName] = dependencyRange.trim();
  }

  return sortedRecord(dependencyMap);
}

function parseRequiredTools(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid manifest compatibility field 'requiredTools'.");
  }
  const tools = value.map((item, index) =>
    asNonEmptyString(item, `compatibility.requiredTools[${index}]`),
  );
  return [...new Set(tools)].sort();
}

function parseCapabilities(value: unknown): McpServerConfig['capabilities'] {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid server field 'capabilities'.");
  }

  const parsed: McpServerConfig['capabilities'] = {};
  if (value.defaultScope !== undefined) {
    if (
      typeof value.defaultScope !== 'string' ||
      !CAPABILITY_SCOPES.has(value.defaultScope as McpCapabilityScope)
    ) {
      throw new Error("Invalid server capability 'defaultScope'.");
    }
    parsed.defaultScope = value.defaultScope as McpCapabilityScope;
  }

  if (value.tools !== undefined) {
    if (!isRecord(value.tools)) {
      throw new Error("Invalid server capability map 'tools'.");
    }
    const tools: Record<string, McpCapabilityScope> = {};
    for (const [toolName, scopeValue] of Object.entries(value.tools)) {
      if (
        typeof scopeValue !== 'string' ||
        !CAPABILITY_SCOPES.has(scopeValue as McpCapabilityScope)
      ) {
        throw new Error(`Invalid capability scope for tool '${toolName}'.`);
      }
      tools[toolName] = scopeValue as McpCapabilityScope;
    }
    parsed.tools = sortedRecord(tools);
  }

  return parsed;
}

function parseServerConfig(value: unknown): McpServerConfig {
  if (!isRecord(value)) {
    throw new Error("Invalid manifest field 'server'.");
  }

  const id = asNonEmptyString(value.id, 'server.id');
  const name = asNonEmptyString(value.name, 'server.name');
  const description = asNonEmptyString(value.description, 'server.description');
  const transport = asNonEmptyString(value.transport, 'server.transport');
  if (transport !== 'stdio' && transport !== 'sse') {
    throw new Error(`Invalid server transport '${transport}'.`);
  }
  const command = asNonEmptyString(value.command, 'server.command');
  if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string')) {
    throw new Error("Invalid manifest field 'server.args'. Expected string array.");
  }

  let env: Record<string, string> | undefined;
  if (value.env !== undefined) {
    if (!isRecord(value.env)) {
      throw new Error("Invalid manifest field 'server.env'.");
    }
    env = {};
    for (const [envName, envValue] of Object.entries(value.env)) {
      if (typeof envValue !== 'string') {
        throw new Error(`Invalid env value for '${envName}' in server.env.`);
      }
      env[envName] = envValue;
    }
    env = sortedRecord(env);
  }

  return {
    id,
    name,
    description,
    transport,
    command,
    args: [...value.args],
    env,
    autoConnect:
      value.autoConnect === undefined ? undefined : Boolean(value.autoConnect),
    enabled: value.enabled === undefined ? undefined : Boolean(value.enabled),
    capabilities: parseCapabilities(value.capabilities),
  };
}

function parseManifest(value: unknown): SkillPackageManifest {
  if (!isRecord(value)) {
    throw new Error('Invalid package manifest entry.');
  }

  const packageName = asNonEmptyString(value.name, 'name');
  const version = asNonEmptyString(value.version, 'version');
  if (!parseSemver(version)) {
    throw new Error(`Package '${packageName}' has invalid semver version '${version}'.`);
  }

  if (!isRecord(value.metadata)) {
    throw new Error(`Package '${packageName}@${version}' is missing metadata.`);
  }

  const metadata = {
    displayName: asNonEmptyString(value.metadata.displayName, 'metadata.displayName'),
    description: asNonEmptyString(value.metadata.description, 'metadata.description'),
    deprecated:
      value.metadata.deprecated === undefined ? undefined : Boolean(value.metadata.deprecated),
    deprecationMessage:
      value.metadata.deprecationMessage === undefined
        ? undefined
        : asNonEmptyString(value.metadata.deprecationMessage, 'metadata.deprecationMessage'),
  };

  let compatibility: SkillPackageManifest['compatibility'];
  if (value.compatibility !== undefined) {
    if (!isRecord(value.compatibility)) {
      throw new Error(`Package '${packageName}@${version}' has invalid compatibility block.`);
    }
    compatibility = {
      node:
        value.compatibility.node === undefined
          ? undefined
          : asNonEmptyString(value.compatibility.node, 'compatibility.node'),
      runtimeApi:
        value.compatibility.runtimeApi === undefined
          ? undefined
          : asNonEmptyString(value.compatibility.runtimeApi, 'compatibility.runtimeApi'),
      requiredTools: parseRequiredTools(value.compatibility.requiredTools),
    };
  }

  return {
    name: packageName,
    version,
    metadata,
    dependencies: parseDependencyMap(value.dependencies, 'dependencies'),
    compatibility,
    server: parseServerConfig(value.server),
  };
}

function parseCatalog(rawContent: string): SkillPackageCatalog {
  const parsed = JSON.parse(rawContent) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.packages)) {
    throw new Error("Invalid package catalog. Expected object with 'packages' array.");
  }

  const manifests = parsed.packages.map((entry) => parseManifest(entry));
  const seen = new Set<string>();
  for (const manifest of manifests) {
    const key = `${manifest.name}@${manifest.version}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate package manifest '${key}' in catalog.`);
    }
    seen.add(key);
  }

  manifests.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return compareSemver(b.version, a.version);
  });

  return { packages: manifests };
}

function parseLockEntry(packageName: string, value: unknown): SkillPackageLockEntry {
  if (!isRecord(value)) {
    throw new Error(`Invalid lockfile entry '${packageName}'.`);
  }

  const name = asNonEmptyString(value.name, `${packageName}.name`);
  const version = asNonEmptyString(value.version, `${packageName}.version`);
  if (!parseSemver(version)) {
    throw new Error(`Invalid semver in lockfile entry '${packageName}'.`);
  }

  return {
    name,
    version,
    dependencies: parseDependencyMap(value.dependencies, `${packageName}.dependencies`),
    checksum: asNonEmptyString(value.checksum, `${packageName}.checksum`),
    integrity: asNonEmptyString(value.integrity, `${packageName}.integrity`),
    installedAt: asNonEmptyString(value.installedAt, `${packageName}.installedAt`),
  };
}

function normalizeLockfile(lockfile: SkillPackageLockfile): SkillPackageLockfile {
  const normalizedPackages: Record<string, SkillPackageLockEntry> = {};
  for (const packageName of Object.keys(lockfile.packages).sort()) {
    const entry = lockfile.packages[packageName];
    if (!entry) continue;
    normalizedPackages[packageName] = {
      ...entry,
      dependencies: sortedRecord(entry.dependencies),
    };
  }

  return {
    version: LOCKFILE_VERSION,
    generatedAt: lockfile.generatedAt,
    packages: normalizedPackages,
  };
}

function emptyLockfile(): SkillPackageLockfile {
  return {
    version: LOCKFILE_VERSION,
    generatedAt: new Date(0).toISOString(),
    packages: {},
  };
}

function parseLockfile(rawContent: string): SkillPackageLockfile {
  const parsed = JSON.parse(rawContent) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Invalid lockfile root content.');
  }

  if (parsed.version !== LOCKFILE_VERSION) {
    throw new Error(
      `Unsupported lockfile version '${String(parsed.version)}'. Expected ${LOCKFILE_VERSION}.`,
    );
  }

  if (!isRecord(parsed.packages)) {
    throw new Error("Invalid lockfile field 'packages'.");
  }

  const packages: Record<string, SkillPackageLockEntry> = {};
  for (const [packageName, entryValue] of Object.entries(parsed.packages)) {
    packages[packageName] = parseLockEntry(packageName, entryValue);
  }

  const generatedAt = asNonEmptyString(parsed.generatedAt, 'generatedAt');
  return normalizeLockfile({
    version: LOCKFILE_VERSION,
    generatedAt,
    packages,
  });
}

export class SkillPackageManager {
  readonly #catalogPath: string;
  readonly #lockPath: string;
  readonly #runtimeApiVersion: string;

  constructor(options: SkillPackageManagerOptions = {}) {
    this.#catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
    this.#lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
    this.#runtimeApiVersion = options.runtimeApiVersion ?? DEFAULT_RUNTIME_API_VERSION;
  }

  async getActivationPlan(): Promise<SkillPackageActivationPlan> {
    const [catalog, lockfile] = await Promise.all([
      this.#readCatalog(),
      this.#readLockfile(),
    ]);
    return this.#buildActivationPlan(catalog, lockfile);
  }

  async getDiagnostics(): Promise<SkillPackageDiagnostics> {
    const plan = await this.getActivationPlan();
    return plan.diagnostics;
  }

  async installPackage(
    packageName: string,
    versionRange?: string,
  ): Promise<SkillPackageMutationResult> {
    const targetName = packageName.trim();
    if (!targetName) {
      throw new Error('Package name is required for install.');
    }

    const [catalog, currentLock] = await Promise.all([
      this.#readCatalog(),
      this.#readLockfile(),
    ]);
    const targetEntry = currentLock.packages[targetName];
    const effectiveRange =
      versionRange?.trim() ??
      (targetEntry ? `=${targetEntry.version}` : '*');

    const selected = this.#solveSelection(catalog, currentLock, targetName, effectiveRange);
    this.#assertCompatibility(selected);

    const nextLock = this.#buildLockfileFromSelection(selected, currentLock);
    const changed = this.#serializeLockfile(currentLock) !== this.#serializeLockfile(nextLock);
    await this.#persistLockfileWithRollback(currentLock, nextLock);

    const diagnostics = await this.getDiagnostics();
    return {
      action: 'install',
      packageName: targetName,
      version: selected.get(targetName)?.version,
      changed,
      diagnostics,
    };
  }

  async upgradePackage(
    packageName: string,
    versionRange?: string,
  ): Promise<SkillPackageMutationResult> {
    const targetName = packageName.trim();
    if (!targetName) {
      throw new Error('Package name is required for upgrade.');
    }

    const [catalog, currentLock] = await Promise.all([
      this.#readCatalog(),
      this.#readLockfile(),
    ]);

    const selected = this.#solveSelection(
      catalog,
      currentLock,
      targetName,
      versionRange?.trim() || '*',
    );
    this.#assertCompatibility(selected);

    const nextLock = this.#buildLockfileFromSelection(selected, currentLock);
    const changed = this.#serializeLockfile(currentLock) !== this.#serializeLockfile(nextLock);
    await this.#persistLockfileWithRollback(currentLock, nextLock);

    const diagnostics = await this.getDiagnostics();
    return {
      action: 'upgrade',
      packageName: targetName,
      version: selected.get(targetName)?.version,
      changed,
      diagnostics,
    };
  }

  async uninstallPackage(packageName: string): Promise<SkillPackageMutationResult> {
    const targetName = packageName.trim();
    if (!targetName) {
      throw new Error('Package name is required for uninstall.');
    }

    const currentLock = await this.#readLockfile();
    const targetEntry = currentLock.packages[targetName];
    if (!targetEntry) {
      throw new Error(`Package '${targetName}' is not installed.`);
    }

    const dependents = Object.values(currentLock.packages)
      .filter((entry) => entry.name !== targetName && entry.dependencies[targetName] !== undefined)
      .map((entry) => `${entry.name}@${entry.version}`);
    if (dependents.length > 0) {
      throw new Error(
        `Cannot uninstall '${targetName}'. Depended on by: ${dependents.join(', ')}.`,
      );
    }

    const nextPackages = { ...currentLock.packages };
    delete nextPackages[targetName];

    const nextLock = normalizeLockfile({
      version: LOCKFILE_VERSION,
      generatedAt: new Date().toISOString(),
      packages: nextPackages,
    });
    const changed = this.#serializeLockfile(currentLock) !== this.#serializeLockfile(nextLock);
    await this.#persistLockfileWithRollback(currentLock, nextLock);

    const diagnostics = await this.getDiagnostics();
    return {
      action: 'uninstall',
      packageName: targetName,
      changed,
      diagnostics,
    };
  }

  #solveSelection(
    catalog: SkillPackageCatalog,
    currentLock: SkillPackageLockfile,
    targetName: string,
    targetRange: string,
  ): Map<string, SkillPackageManifest> {
    const manifestIndex = buildManifestIndex(catalog.packages);
    const constraints = new Map<string, string[]>();

    for (const entry of Object.values(currentLock.packages)) {
      if (entry.name !== targetName) {
        addConstraint(constraints, entry.name, `=${entry.version}`);
      }
    }
    addConstraint(constraints, targetName, targetRange);

    const solved = solveSelection(manifestIndex, constraints, new Map());
    if (solved) {
      return solved;
    }

    const conflict = findSolverConflict(constraints, manifestIndex);
    if (conflict) {
      const availableText =
        conflict.available.length > 0 ? conflict.available.join(', ') : '(none)';
      throw new Error(
        `No compatible version found for '${conflict.packageName}' with constraints [${conflict.ranges.join(
          ', ',
        )}]. Available versions: ${availableText}.`,
      );
    }

    throw new Error(`Failed to resolve package graph for '${targetName}'.`);
  }

  #assertCompatibility(selection: Map<string, SkillPackageManifest>): void {
    const violations: SkillPackageViolation[] = [];
    const selectionByName = new Map<string, SkillPackageManifest>(selection);
    const sortedSelection = [...selection.values()].sort((a, b) => a.name.localeCompare(b.name));

    for (const manifest of sortedSelection) {
      const packageViolations = this.#evaluateManifestCompatibility(manifest);
      violations.push(...packageViolations);

      const dependencies = manifest.dependencies ?? {};
      for (const dependencyName of Object.keys(dependencies).sort()) {
        const dependencyRange = dependencies[dependencyName];
        const selectedDependency = selectionByName.get(dependencyName);
        if (!selectedDependency) {
          violations.push(
            this.#buildViolation(
              manifest.name,
              manifest.version,
              'missing-dependency',
              `Dependency '${dependencyName}' is missing from the resolved graph.`,
              `Add '${dependencyName}' to the catalog and satisfy range '${dependencyRange}'.`,
            ),
          );
          continue;
        }

        if (!satisfiesRange(selectedDependency.version, dependencyRange)) {
          violations.push(
            this.#buildViolation(
              manifest.name,
              manifest.version,
              'version-conflict',
              `Dependency '${dependencyName}@${selectedDependency.version}' does not satisfy '${dependencyRange}'.`,
              `Adjust version constraints for '${manifest.name}' or '${dependencyName}'.`,
            ),
          );
        }
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map(
          (violation) =>
            `[${violation.code}] ${violation.packageName}@${violation.version}: ${violation.message} (${violation.remediation})`,
        )
        .join(' | ');
      throw new Error(`Compatibility gate blocked activation: ${message}`);
    }
  }

  #evaluateManifestCompatibility(manifest: SkillPackageManifest): SkillPackageViolation[] {
    const violations: SkillPackageViolation[] = [];
    const compatibility = manifest.compatibility;
    if (!compatibility) {
      return violations;
    }

    if (compatibility.node && !satisfiesRange(process.version.replace(/^v/, ''), compatibility.node)) {
      violations.push(
        this.#buildViolation(
          manifest.name,
          manifest.version,
          'node-incompatible',
          `Runtime Node.js ${process.version} does not satisfy '${compatibility.node}'.`,
          `Use a Node.js version that matches '${compatibility.node}'.`,
        ),
      );
    }

    if (
      compatibility.runtimeApi &&
      !satisfiesRange(this.#runtimeApiVersion, compatibility.runtimeApi)
    ) {
      violations.push(
        this.#buildViolation(
          manifest.name,
          manifest.version,
          'runtime-api-incompatible',
          `Runtime API ${this.#runtimeApiVersion} does not satisfy '${compatibility.runtimeApi}'.`,
          `Install a compatible package version or upgrade runtime API.`,
        ),
      );
    }

    const requiredTools = compatibility.requiredTools ?? [];
    for (const toolName of requiredTools) {
      if (!this.#commandExists(toolName)) {
        violations.push(
          this.#buildViolation(
            manifest.name,
            manifest.version,
            'missing-required-tool',
            `Required executable '${toolName}' is not available on PATH.`,
            `Install '${toolName}' or remove this package.`,
          ),
        );
      }
    }

    return violations;
  }

  #buildActivationPlan(
    catalog: SkillPackageCatalog,
    lockfile: SkillPackageLockfile,
  ): SkillPackageActivationPlan {
    const manifestByKey = new Map<string, SkillPackageManifest>();
    for (const manifest of catalog.packages) {
      manifestByKey.set(`${manifest.name}@${manifest.version}`, manifest);
    }

    const installedEntries = Object.values(lockfile.packages).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const warnings: string[] = [];
    const violations: SkillPackageViolation[] = [];
    const servers: McpServerConfig[] = [];
    const seenServerIds = new Set<string>();

    for (const entry of installedEntries) {
      const manifest = manifestByKey.get(`${entry.name}@${entry.version}`);
      if (!manifest) {
        violations.push(
          this.#buildViolation(
            entry.name,
            entry.version,
            'missing-manifest',
            `Installed package '${entry.name}@${entry.version}' is missing from catalog.`,
            `Reinstall '${entry.name}' from an available version or update the catalog.`,
          ),
        );
        continue;
      }

      if (manifest.metadata.deprecated) {
        warnings.push(
          manifest.metadata.deprecationMessage ??
            `Package '${entry.name}@${entry.version}' is deprecated.`,
        );
      }

      const compatibilityViolations = this.#evaluateManifestCompatibility(manifest);
      violations.push(...compatibilityViolations);

      let dependencyConflict = false;
      for (const [dependencyName, dependencyRange] of Object.entries(entry.dependencies)) {
        const installedDependency = lockfile.packages[dependencyName];
        if (!installedDependency) {
          dependencyConflict = true;
          violations.push(
            this.#buildViolation(
              entry.name,
              entry.version,
              'missing-dependency',
              `Dependency '${dependencyName}' is not installed.`,
              `Install '${dependencyName}' with range '${dependencyRange}'.`,
            ),
          );
          continue;
        }

        if (!satisfiesRange(installedDependency.version, dependencyRange)) {
          dependencyConflict = true;
          violations.push(
            this.#buildViolation(
              entry.name,
              entry.version,
              'version-conflict',
              `Dependency '${dependencyName}@${installedDependency.version}' violates '${dependencyRange}'.`,
              `Upgrade or downgrade '${dependencyName}' to satisfy '${dependencyRange}'.`,
            ),
          );
        }
      }

      if (
        compatibilityViolations.length === 0 &&
        !dependencyConflict &&
        !seenServerIds.has(manifest.server.id)
      ) {
        seenServerIds.add(manifest.server.id);
        servers.push(manifest.server);
        continue;
      }

      if (seenServerIds.has(manifest.server.id)) {
        violations.push(
          this.#buildViolation(
            entry.name,
            entry.version,
            'duplicate-server-id',
            `Server id '${manifest.server.id}' is already provided by another active package.`,
            `Uninstall one package that provides '${manifest.server.id}'.`,
          ),
        );
      }
    }

    return {
      servers,
      diagnostics: {
        installed: installedEntries,
        warnings,
        violations,
        activePackageCount: servers.length,
        blockedPackageCount: Math.max(installedEntries.length - servers.length, 0),
      },
    };
  }

  #commandExists(commandName: string): boolean {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(checker, [commandName], { stdio: 'ignore' });
    return result.status === 0;
  }

  #buildViolation(
    packageName: string,
    version: string,
    code: SkillPackageViolationCode,
    message: string,
    remediation: string,
  ): SkillPackageViolation {
    return {
      packageName,
      version,
      code,
      message,
      remediation,
    };
  }

  #buildLockfileFromSelection(
    selection: Map<string, SkillPackageManifest>,
    currentLock: SkillPackageLockfile,
  ): SkillPackageLockfile {
    const now = new Date().toISOString();
    const packages: Record<string, SkillPackageLockEntry> = {};
    const manifests = [...selection.values()].sort((a, b) => a.name.localeCompare(b.name));

    for (const manifest of manifests) {
      const existing = currentLock.packages[manifest.name];
      const checksum = this.#manifestChecksum(manifest);
      packages[manifest.name] = {
        name: manifest.name,
        version: manifest.version,
        dependencies: sortedRecord(manifest.dependencies ?? {}),
        checksum,
        integrity: `sha256-${checksum}`,
        installedAt:
          existing && existing.version === manifest.version ? existing.installedAt : now,
      };
    }

    return normalizeLockfile({
      version: LOCKFILE_VERSION,
      generatedAt: now,
      packages,
    });
  }

  #manifestChecksum(manifest: SkillPackageManifest): string {
    const stableManifest = {
      ...manifest,
      dependencies: sortedRecord(manifest.dependencies ?? {}),
      compatibility: manifest.compatibility
        ? {
            ...manifest.compatibility,
            requiredTools: [...(manifest.compatibility.requiredTools ?? [])].sort(),
          }
        : undefined,
      server: {
        ...manifest.server,
        args: [...manifest.server.args],
        env: manifest.server.env ? sortedRecord(manifest.server.env) : undefined,
        capabilities: manifest.server.capabilities
          ? {
              ...manifest.server.capabilities,
              tools: manifest.server.capabilities.tools
                ? sortedRecord(manifest.server.capabilities.tools)
                : undefined,
            }
          : undefined,
      },
    };

    return createHash('sha256')
      .update(JSON.stringify(stableManifest))
      .digest('hex');
  }

  async #persistLockfileWithRollback(
    previousLock: SkillPackageLockfile,
    nextLock: SkillPackageLockfile,
  ): Promise<void> {
    const snapshot = this.#serializeLockfile(previousLock);
    try {
      await this.#writeLockfile(nextLock);
    } catch (error) {
      await this.#restoreLockSnapshot(snapshot);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Lockfile update failed; rollback applied. ${message}`);
    }
  }

  async #restoreLockSnapshot(snapshot: string): Promise<void> {
    const tempPath = `${this.#lockPath}.rollback`;
    await writeFile(tempPath, snapshot, 'utf8');
    await rename(tempPath, this.#lockPath);
  }

  async #writeLockfile(lockfile: SkillPackageLockfile): Promise<void> {
    const normalized = normalizeLockfile(lockfile);
    const serialized = this.#serializeLockfile(normalized);
    const tempPath = `${this.#lockPath}.tmp`;
    await writeFile(tempPath, serialized, 'utf8');
    await rename(tempPath, this.#lockPath);
  }

  #serializeLockfile(lockfile: SkillPackageLockfile): string {
    return `${JSON.stringify(normalizeLockfile(lockfile), null, 2)}\n`;
  }

  async #readCatalog(): Promise<SkillPackageCatalog> {
    await this.#ensureFileExists(
      this.#catalogPath,
      `${JSON.stringify({ packages: [] }, null, 2)}\n`,
    );
    const content = await readFile(this.#catalogPath, 'utf8');
    return parseCatalog(content);
  }

  async #readLockfile(): Promise<SkillPackageLockfile> {
    await this.#ensureFileExists(this.#lockPath, this.#serializeLockfile(emptyLockfile()));
    const content = await readFile(this.#lockPath, 'utf8');
    return parseLockfile(content);
  }

  async #ensureFileExists(filePath: string, defaultContent: string): Promise<void> {
    try {
      await access(filePath);
    } catch {
      await writeFile(filePath, defaultContent, 'utf8');
    }
  }
}

