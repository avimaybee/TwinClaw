import fs from 'fs/promises';
import path from 'path';
/**
 * Assembles the system prompt by compiling core identity files.
 */
export async function assembleContext(additionalRuntimeContext = '') {
    let soul = '';
    let identity = '';
    let user = '';
    const readOptionalFile = async (filePath) => {
        try {
            return await fs.readFile(path.resolve(filePath), 'utf-8');
        }
        catch {
            return '';
        }
    };
    soul = await readOptionalFile('identity/soul.md');
    identity = await readOptionalFile('identity/identity.md');
    user = await readOptionalFile('identity/user.md');
    const compiled = `
You are TwinClaw. Follow your core directives exactly.

${soul ? `### CORE SOUL & DIRECTIVES\n${soul}` : ''}

${identity ? `### IDENTITY & PERSONA\n${identity}` : ''}

${user ? `### USER PREFERENCES\n${user}` : ''}

${additionalRuntimeContext ? `### ADDITIONAL CONTEXT (RAG MEMORY)\n${additionalRuntimeContext}` : ''}
  `.trim();
    return compiled;
}
