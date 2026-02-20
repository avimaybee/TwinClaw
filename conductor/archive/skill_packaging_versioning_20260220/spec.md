# Specification: Skill Packaging, Version Pinning & Compatibility Gate

## Overview
This track standardizes skill distribution with explicit package manifests, semantic versioning, compatibility checks, and lock-based pinning so deployments remain reproducible and safe.

## Requirements
- Define a skill package manifest contract including skill metadata, dependencies, and engine compatibility.
- Add install/upgrade/uninstall workflows with version pinning and lockfile updates.
- Add compatibility gate checks before activation (engine version, required tools, API surface).
- Add rollback strategy for failed upgrades.
- Add diagnostics that report installed versions, constraint violations, and resolution guidance.

## Technical Mandates
- Reuse existing skill discovery/loader pathways.
- Enforce semver comparison rules consistently across CLI and runtime.
- Keep lockfile deterministic to support reproducible environments.
- Add regression tests for version conflict and rollback scenarios.
