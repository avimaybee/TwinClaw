# Specification: Gateway Supervision & Remote Access Integration

## Core Goal
Fulfill the deployment and continuous operation requirements of the TwinClaw agent by implementing the Gateway Runbook mechanisms for supervision, service lifecycles, and remote access. 

## Context
TwinClaw agents are meant to be asynchronous, proactive workers running 24/7. Relying on an interactive terminal window executing `npm start` is insufficient for production. Integrating the standard `twinclaw gateway install/restart/status` capabilities makes TwinClaw resilient to machine reboots and enables reliable remote control.

## Requirements
1. **Operator Command Set:** Implement the lifecycle commands: `twinclaw gateway install`, `restart`, `stop`, `status [--deep | --json]`.
2. **Native Supervision Integration:** 
   - `launchd` for macOS.
   - `systemd` (user and system service) for Linux.
   - `node-windows` (or equivalent) for Windows services.
3. **Multiple Gateways:** Fully support overriding ports and configurations so multiple gateways can be supervised on a single host.
4. **Remote Access & Tailscale:** Provide tooling/scripts for authenticated remote access points (e.g. `ws://127.0.0.1:18789`) running securely over Tailscale Funnel or SSH tunnels without exposing local ports.
5. **Operational Checks:** Implement standard `Liveness` and `Readiness` endpoints for automated load balancing and deployment verification.
