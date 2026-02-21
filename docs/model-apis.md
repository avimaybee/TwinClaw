# Model APIs

This document provides reference information for configuring AI model providers in TwinClaw.

## Modal Research API (Primary)

- **Endpoint**: `https://api.us-west-2.modal.direct/v1`
- **Model**: `zai-org/GLM-5-FP8`
- **Configuration**: Set the API key in `twinclaw.json` under `apiKeys.modal`

## OpenRouter (Secondary/Fallback)

- **Model**: `stepfun/step-3.5-flash:free`
- **Configuration**: Set the API key in `twinclaw.json` under `apiKeys.openrouter`

## Google AI Studio (Deep Context Fallback)

- **Model**: `gemini-flash-lite-latest`
- **Configuration**: Set the API key in `twinclaw.json` under `apiKeys.google`
