# Specification: MCP Skill Registry & External Server Integrations

## Overview
This track upgrades the skill subsystem into an extensible registry that can host local tools and MCP-backed remote skills (GitHub, Context7, Zapier) behind a uniform contract.

## Requirements
- Define a typed skill registry capable of registering local and MCP-backed skills.
- Implement runtime loading for configured MCP servers.
- Expose MCP tools through the same lane execution model used by local tools.
- Add robust error boundaries so one MCP server failure does not crash the gateway.

## Technical Mandates
- Keep the skill contract strictly typed and serializable.
- Route all tool calls through one lane executor path.
- Log MCP invocation metadata in the same transcript stream.
