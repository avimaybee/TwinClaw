# Specification: TwinClaw Workspace & Profile Alignment

## Core Goal
Align TwinClaw's local directory structure and profile management tightly with the OpenClaw architecture's `Workspace` semantics, migrating from any ad-hoc local configurations to a standardized state management paradigm under the `TwinClaw` brand.

## Context
TwinClaw relies on a local filesystem to persist configuration, memory, and identity files. By adhering strictly to OpenClaw workspaces semantics but localized to (`~/.twinclaw/workspace`), we gain built-in support for environment-based profile isolation, simplified backup strategies, and better documentation compatibility.

## Requirements
1. **Workspace Location:** Move TwinClaw's primary state/memory and default configuration location from `~/.twinclaw/` to `~/.twinclaw/workspace`.
2. **Profile Isolation:** Support the `TWINCLAW_PROFILE` environment variable (e.g. `workspace-<profile>`) across all core services (config loading, database initialization, logging).
3. **Workspace File Map Compliance:** Ensure the layout within the workspace matches the OpenClaw standard (e.g., config files, identities, memories are separated logically) but localized to our app.
4. **Git Backup Support:** Establish a clear pattern (e.g., `.gitignore` generation) recommending users store their workspace in a private Git repository, excluding sensitive databases and vault DBs.
5. **Backwards Compatibility / Migration:** When the application boots, carefully check if an old flat `~/.twinclaw/` config exists and prompt or automatically migrate the user to the new structured `~/.twinclaw/workspace` location.
