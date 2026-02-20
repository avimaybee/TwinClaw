import type { Skill, SkillSource } from '../skills/types.js';
import { logThought } from '../utils/logger.js';

/** Filter criteria for querying skills from the registry. */
export interface SkillFilter {
    source?: SkillSource;
    serverId?: string;
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

    /** Register a single skill. Overwrites if a skill with the same name already exists. */
    register(skill: Skill): void {
        const source = skill.source ?? 'builtin';
        this.#skills.set(skill.name, { ...skill, source });
        void logThought(
            `[SkillRegistry] Registered skill '${skill.name}' (source: ${source}).`,
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
        return this.#skills.delete(name);
    }

    /** Unregister all skills from a specific MCP server. */
    unregisterByServer(serverId: string): number {
        let count = 0;
        for (const [name, skill] of this.#skills) {
            if (skill.serverId === serverId) {
                this.#skills.delete(name);
                count++;
            }
        }
        return count;
    }

    /** Look up a skill by its unique name. */
    get(name: string): Skill | undefined {
        return this.#skills.get(name);
    }

    /** Check if a skill with the given name exists in the registry. */
    has(name: string): boolean {
        return this.#skills.has(name);
    }

    /** List all registered skills, optionally filtered by source or server. */
    list(filter?: SkillFilter): Skill[] {
        const all = [...this.#skills.values()];

        if (!filter) return all;

        return all.filter((skill) => {
            if (filter.source && skill.source !== filter.source) return false;
            if (filter.serverId && skill.serverId !== filter.serverId) return false;
            return true;
        });
    }

    /** Return the total number of registered skills. */
    get size(): number {
        return this.#skills.size;
    }

    /** Return a summary of skills grouped by source. */
    summary(): Record<string, number> {
        const counts: Record<string, number> = { builtin: 0, mcp: 0 };
        for (const skill of this.#skills.values()) {
            const source = skill.source ?? 'builtin';
            counts[source] = (counts[source] ?? 0) + 1;
        }
        return counts;
    }
}
