# Project Workflow: TwinClaw

## Development Methodology
- **Track-Based Implementation:** All work is organized into "Tracks" (features or bug fixes), with individual plans (`plan.md`) and specifications (`spec.md`).
- **Test-Driven Development (TDD):** (Optional but recommended) Prioritize writing tests before implementation.
- **Phase-Based Checkpoints:** Each major phase of work concludes with a manual verification and checkpointing protocol.

## Standards
- **Test Coverage:** >80% code test coverage is required for all features.
- **Source Control:** Commit changes after every task is completed.
- **Task Summaries:** Use Git Notes to record a summary of each task's implementation.

## Security & Quality
- **Review:** All code must be reviewed against the `product-guidelines.md` and `code_styleguides/` before completion.
- **Sanitization:** All tool call outputs must be scrubbed for sensitive API keys.
- **Audit Trail:** Maintain a daily Markdown transcript (`YYYY-MM-DD.md`) for all system actions.
