# Specification: Type-Safety & Reliability Stabilization

## Goal
To eliminate runtime errors caused by missing type definitions and ensure a consistent, reliable testing environment.

## Requirements
- **Type Safety:** 0 `any` usage in `src/services`, `src/core`, `src/api`.
- **Testing:** 100% pass rate in CI without retries.
- **Build:** Fast, deterministic builds on all platforms.

## Technical Mandates
- Use `unknown` and type guards instead of `any`.
- Mock external services and databases where they increase flakiness.
