# Implementation Plan: Gateway Supervision & Remote Access Integration

## Phase 1: Service Lifecycle Management
- [x] **Task: Create OS Service Bridges**
  - [x] Implement `launchd` plist template generator for macOS (`twinclaw gateway install`).
  - [x] Implement `systemd` service template generator for Linux.
  - [x] Implement Windows service installer using `node-windows`.
- [x] **Task: Wire CLI Supervisor Commands**
  - [x] Implement `twinclaw gateway install/start/stop/restart/status` in the main CLI entrypoint.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Remote Access & Tunnels
- [x] **Task: Secure WebSocket Access Path**
  - [x] Expose an authenticated remote access stream on the HTTP control plane API (e.g. standard `18789` port config).
  - [x] Enforce token/password exchange over WebSocket handshake to block unauthorized connections.
- [x] **Task: Tailscale/SSH Guide Integration**
  - [x] Build automated `gateway.tailscale` configuration wizard steps.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Liveness, Readiness, & Logs
- [x] **Task: Add Operator Liveness Probes**
  - [x] Expand the `GET /health` endpoint to differentiate `/health/live` and `/health/ready`.
- [x] **Task: `twinclaw logs --follow` Implementation**
  - [x] Stream structured logs from the background daemon securely to the user's terminal invoking this command.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
