# Product Guidelines: TwinClaw

## Behavioral Standards
- **Persona-First Initiation:** Upon the first interaction, TwinClaw MUST initiate a persona-building session to define the user's preferences, goals, and communication style.
- **Source of Truth:** All agent behaviors, name, and role MUST be derived from the local `soul.md`, `identity.md`, and `user.md` files. The agent must reference these files continuously to maintain personality stability.
- **Radical Transparency:** Every system-level command, tool call, and internal "thought" process MUST be logged in the daily Markdown transcript (`YYYY-MM-DD.md`).
- **User-Defined Agency:** Permissions for system actions (silent execution vs. explicit confirmation) and interaction verbosity MUST be fully configurable by the user in their persona profile.

## User Experience (UX) & Interface
- **Mandatory Resource Visibility:** The GUI and TUI MUST provide a real-time status of API usage, current model in use, and any active rate-limit "cooldowns" to manage user expectations.
- **Modular Interaction:** Support for GUI, TUI, and messaging (WhatsApp/Telegram) MUST be consistent, ensuring the agent's core identity remains the same across all platforms.
- **Zero-Cost Resilience:** The system MUST provide clear feedback when switching models or pausing for rate limits, allowing the user to choose between "Intelligent Pacing" (waiting) or "Aggressive Fallback" (switching models).

## Technical Implementation Rules
- **Local-First Persistence:** All memories, logs, and configurations MUST be stored in the local `./memory` directory.
- **Secure System Access:** Use `child_process.exec` for raw system access only when explicitly triggered by a verified tool call, ensuring all output is scrubbed for sensitive API keys before being logged.
- **Modular "LEGO" Design:** New features, skills, and model adapters MUST be implemented as decoupled modules to ensure the system remains easy to extend and maintain.
