import type { McpServerConfig } from './mcp.js';

export interface SkillPackageMetadata {
  displayName: string;
  description: string;
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface SkillPackageCompatibility {
  node?: string;
  runtimeApi?: string;
  requiredTools?: string[];
}

export interface SkillPackageManifest {
  name: string;
  version: string;
  metadata: SkillPackageMetadata;
  dependencies?: Record<string, string>;
  compatibility?: SkillPackageCompatibility;
  server: McpServerConfig;
}

export interface SkillPackageCatalog {
  packages: SkillPackageManifest[];
}

export interface SkillPackageLockEntry {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  checksum: string;
  integrity: string;
  installedAt: string;
}

export interface SkillPackageLockfile {
  version: 1;
  generatedAt: string;
  packages: Record<string, SkillPackageLockEntry>;
}

export type SkillPackageViolationCode =
  | 'missing-manifest'
  | 'version-conflict'
  | 'node-incompatible'
  | 'runtime-api-incompatible'
  | 'missing-required-tool'
  | 'missing-dependency'
  | 'duplicate-server-id';

export interface SkillPackageViolation {
  packageName: string;
  version: string;
  code: SkillPackageViolationCode;
  message: string;
  remediation: string;
}

export interface SkillPackageDiagnostics {
  installed: SkillPackageLockEntry[];
  warnings: string[];
  violations: SkillPackageViolation[];
  activePackageCount: number;
  blockedPackageCount: number;
}

export interface SkillPackageActivationPlan {
  servers: McpServerConfig[];
  diagnostics: SkillPackageDiagnostics;
}

export interface SkillPackageMutationResult {
  action: 'install' | 'upgrade' | 'uninstall';
  packageName: string;
  version?: string;
  changed: boolean;
  diagnostics: SkillPackageDiagnostics;
}

