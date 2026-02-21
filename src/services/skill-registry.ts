import type { Skill, SkillGroup, SkillSource } from '../skills/types.js';
import { logThought } from '../utils/logger.js';

/** Filter criteria for querying skills from the registry. */
export interface SkillFilter {
    source?: SkillSource;
    serverId?: string;
    group?: SkillGroup;
}

export interface SkillRegistrySummary {
    builtin: number;
    mcp: number;
    groups: Record<string, number>;
}

/**
 * Centralized skill registry for TwinClaw.
 *
 * Serves as a single catalog for all available tools — both local builtins
 * and MCP-backed remote skills. The lane executor queries this registry
 * to build the tool list sent to the model router.
 *
 * Usage:
 * ```ts
 * const registry = new SkillRegistry();
 * registry.registerMany(createBuiltinSkills());
 * registry.register(mcpBackedSkill);
 * const allTools = registry.list();
 * ```
 */
export class SkillRegistry {
    readonly #skills: Map<string, Skill> = new Map();
    readonly #aliases: Map<string, string> = new Map();

    #removeAliasesForCanonical(canonicalName: string): void {
        for (const [alias, mappedCanonical] of this.#aliases.entries()) {
            if (mappedCanonical === canonicalName) {
                this.#aliases.delete(alias);
            }
        }
    }

    #resolveCanonicalName(name: string): string {
        return this.#aliases.get(name) ?? name;
    }

    /** Register a single skill. Overwrites if a skill with the same name already exists. */
    register(skill: Skill): void {
        const source = skill.source ?? 'builtin';
        const canonicalName = skill.name;
        this.#removeAliasesForCanonical(canonicalName);

        const normalized: Skill = { ...skill, source };
        this.#skills.set(canonicalName, normalized);

        for (const alias of skill.aliases ?? []) {
            const normalizedAlias = alias.trim();
            if (!normalizedAlias || normalizedAlias === canonicalName) {
                continue;
            }
            if (this.#skills.has(normalizedAlias)) {
                continue;
            }
            this.#aliases.set(normalizedAlias, canonicalName);
        }

        void logThought(
            `[SkillRegistry] Registered skill '${skill.name}' (source: ${source}, aliases: ${skill.aliases?.length ?? 0}).`,
        );
    }

    /** Register multiple skills at once. */
    registerMany(skills: Skill[]): void {
        for (const skill of skills) {
            this.register(skill);
        }
    }

    /** Unregister a skill by name. Returns true if the skill was found and removed. */
    unregister(name: string): boolean {
        const canonicalName = this.#resolveCanonicalName(name);
        const removed = this.#skills.delete(canonicalName);
        if (removed) {
            this.#removeAliasesForCanonical(canonicalName);
        }
        return removed;
    }

    /** Unregister all skills from a specific MCP server. */
    unregisterByServer(serverId: string): number {
        const namesToRemove: string[] = [];
        for (const [name, skill] of this.#skills.entries()) {
            if (skill.serverId === serverId) {
                namesToRemove.push(name);
            }
        }
        for (const name of namesToRemove) {
            this.unregister(name);
        }
        return namesToRemove.length;
    }

    /** Look up a skill by its unique name. */
    get(name: string): Skill | undefined {
        return this.#skills.get(this.#resolveCanonicalName(name));
    }

    /** Check if a skill with the given name exists in the registry. */
    has(name: string): boolean {
        return this.get(name) !== undefined;
    }

    /** List all registered skills, optionally filtered by source or server. */
    list(filter?: SkillFilter): Skill[] {
        const all = [...this.#skills.values()];

        if (!filter) return all;

        return all.filter((skill) => {
            if (filter.source && skill.source !== filter.source) return false;
            if (filter.serverId && skill.serverId !== filter.serverId) return false;
            if (filter.group && skill.group !== filter.group) return false;
            return true;
        });
    }

    /** Return the total number of registered skills. */
    get size(): number {
        return this.#skills.size;
    }

    /** Return a summary of skills grouped by source. */
    summary(): SkillRegistrySummary {
        const counts: SkillRegistrySummary = {
            builtin: 0,
            mcp: 0,
            groups: {},
        };
        for (const skill of this.#skills.values()) {
            const source = skill.source ?? 'builtin';
            if (source === 'builtin' || source === 'mcp') {
                counts[source] += 1;
            }
            if (skill.group) {
                counts.groups[skill.group] = (counts.groups[skill.group] ?? 0) + 1;
            }
        }
        return counts;
    }
}
