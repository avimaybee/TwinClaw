# Specification: Graphical & Terminal User Interfaces

## Overview
This track focuses on making TwinClaw accessible and monitorable. It introduces a Terminal User Interface (TUI) for power users to watch real-time logs and routing metrics, and an Electron/React Graphical User Interface (GUI) to lower the barrier to entry for everyday users managing permissions and API configurations.

## Requirements
- **TUI**: Must run natively in the terminal alongside the background daemon, showing raw logs, current LLM usage, and active tasks.
- **GUI**: A lightweight desktop application to edit agent configurations (e.g., `soul.md`, model selection, messaging integrations) without manually editing JSON or text files.
- **IPC/WebSockets**: Secure local communication between the user interfaces and the core agent runtime.
