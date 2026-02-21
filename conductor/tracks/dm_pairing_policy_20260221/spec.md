# Specification: DM Pairing Policy & Approval Commands

## Overview
This track replaces hardcoded sender allowlists with a pairing-first DM policy (`dmPolicy: "pairing"`), where unknown senders receive short pairing codes and require explicit approval before message processing.

## Requirements
- Set default DM policy for supported channels to pairing-first behavior.
- Generate pairing codes for unknown senders and withhold message processing until approved.
- Provide CLI approvals via `twinclaw pairing list <channel>` and `twinclaw pairing approve <channel> <code>`.
- Persist pending pairing requests and approved identities in local channel credential stores.
- Enforce expiry and throttling constraints to prevent pairing spam and stale grants.

## Technical Mandates
- Pairing codes must be collision-resistant and human-enterable.
- Unknown sender messages must not execute agent loops prior to approval.
- Pairing state persistence must be auditable and resilient across restarts.
- Channel handlers must share a common pairing policy implementation to avoid drift.
