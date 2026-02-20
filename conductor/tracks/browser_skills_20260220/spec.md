# Specification: Browser Autonomy & System Skills (browser_skills_20260220)

## Overview
This track focuses on the "superpowers" of TwinClaw: its ability to interact with the web and the local file system. It includes building a Playwright-based browser engine and a library of modular system skills.

## Requirements
- **Playwright Browser Integration:** Headless/headed Chromium automation.
- **VLM Screenshots & Interaction:** Support for pixel-perfect screenshot analysis using Vision models.
- **System Skill Library:** Modular `child_process.exec` wrapper for local shell commands.
- **Daily Transcript Logging:** Automatic persistence of system actions in `YYYY-MM-DD.md`.

## Technical Mandates
- **Radical Transparency:** Every shell command and its result must be logged.
- **Lego-Block Modularity:** Skills must be defined in a standardized interface for easy expansion.
- **Security Sanitization:** All output must be scrubbed for sensitive credentials.
