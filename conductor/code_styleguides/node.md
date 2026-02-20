# Node.js Style Guide

- **Runtime:** Node.js v22+ with ES Modules (`"type": "module"`).
- **Control Plane:** Use WebSockets (`ws`) for high-performance communication.
- **Asynchronous Patterns:** Leverage `await` for I/O operations. Use `child_process.exec` cautiously for non-sandboxed shell execution.
- **Security:** Use `dotenv-vault` for secure environment variable management. Avoid committing sensitive keys.
- **Error Handling:** Centralize error handlers and use `try/catch` with explicit error logging.
- **Dependencies:** Keep dependencies minimal and favor modern, standard libraries.
