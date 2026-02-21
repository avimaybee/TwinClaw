# Specification: Test Harness FK Integrity & Suite Unblock

## Overview
This track fixes failing orchestration harness tests by aligning test setup with relational constraints and hardening integration-test determinism.

## Requirements
- Resolve `FOREIGN KEY constraint failed` failures in orchestration runner tests.
- Ensure test fixtures create required session parents before orchestration jobs.
- Stabilize affected harness setup/teardown so one failure does not mask the suite.
- Ensure `npm run test` can complete core harness coverage for orchestration paths.

## Technical Mandates
- Keep FK correctness aligned with production schema semantics.
- Prefer reusable test fixture helpers over inline setup duplication.
- Preserve deterministic test ordering and isolation.
- Log root cause and fixture contract assumptions in the track plan notes.
