import fs from 'fs/promises';
import path from 'path';
import { getIdentityDir } from '../config/workspace.js';

export async function assembleContext(additionalRuntimeContext: string = ''): Promise<string> {
    let soul = '';
    let identity = '';
    let user = '';

    const identityDir = getIdentityDir();
    
    const readOptionalFile = async (fileName: string) => {
        try {
            const filePath = path.join(identityDir, fileName);
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return '';
        }
    };

    soul = await readOptionalFile('soul.md');
    identity = await readOptionalFile('identity.md');
    user = await readOptionalFile('user.md');

    const compiled = `
You are TwinClaw. Follow your core directives exactly.

${soul ? `### CORE SOUL & DIRECTIVES\n${soul}` : ''}

${identity ? `### IDENTITY & PERSONA\n${identity}` : ''}

${user ? `### USER PREFERENCES\n${user}` : ''}

${additionalRuntimeContext ? `### ADDITIONAL CONTEXT (RAG MEMORY)\n${additionalRuntimeContext}` : ''}
  `.trim();

    return compiled;
}
