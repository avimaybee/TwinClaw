# TypeScript Style Guide

- **Strict Mode:** Always enable `strict` in `tsconfig.json`.
- **Typing:** Favor explicit typing for function parameters and return types. Use `unknown` and narrow types instead of `any`.
- **Features:** Prefer ES2022+ features like top-level await and class private fields (`#`).
- **Interfaces vs Types:** Use `interface` for public APIs and `type` for internal unions, intersections, and primitives.
- **Naming:** `PascalCase` for classes, interfaces, and types. `camelCase` for variables and functions. `UPPER_SNAKE_CASE` for constants.
- **Async/Await:** Use `async/await` exclusively for asynchronous operations; avoid raw `Promise` chains.
