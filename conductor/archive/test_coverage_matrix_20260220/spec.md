# Specification: Deterministic Service Test Matrix & Coverage Gates

## Overview
This track expands deterministic test coverage across core runtime services so future feature tracks can ship without regressions in orchestration, reliability, and policy behavior.

## Requirements
- Add deterministic service-level tests for retry logic, delivery tracking, and policy evaluation behavior.
- Add shared test helpers/mocks to isolate time, network, and external dependency behavior.
- Expand the test runner scope beyond replay harness tests to include new service suites.
- Add coverage gates and machine-readable reporting to keep quality from regressing.
- Keep all tests runnable locally without external API keys or network calls.

## Technical Mandates
- Reuse Vitest and existing harness patterns; do not introduce a new test framework.
- Keep assertions deterministic (no flaky timing assertions or nondeterministic ordering).
- Prefer unit-level isolation before adding integration scenarios.
- Preserve existing replay harness behavior while expanding coverage breadth.
