# Specification: Message Streaming, Chunking, & Queueing Adoption

## Core Goal
Adopt TwinClaw's advanced block streaming and inbound debouncing patterns, enabling human-like pacing for outbound messages and better tolerance for high-volume inbound floods.

## Context
TwinClaw interfaces (like Telegram and WhatsApp) need to feel natural and responsive. Generating giant blocks of text and sending them all at once feels robotic and creates artificial layout delays. By integrating advanced streaming conventions, we chunk text naturally across paragraphs/sentences and dispatch them smoothly.

## Requirements
1. **Config Harmonization:** Integrate `agents.defaults.blockStreamingDefault`, `agents.defaults.blockStreamingBreak`, and related configuration keys into TwinClaw’s config manager.
2. **Chunking Engine:** Implement or adapt an `EmbeddedBlockChunker` that applies low/high bounds (minChars/maxChars) and splits text by paragraphs then sentences.
3. **Continuous Streaming:** Connect the output delta events of the Language Model directly back to the message dispatcher; flush message blocks either immediately (`text_end`) or at completion (`message_end`).
4. **Coalescing & Delay:** Wait for idle milliseconds before coalescing streamed chunks and applying a `humanDelay` to mimic typing pauses.
5. **Inbound Debouncing:** Implement a debounce window (e.g. `messages.inbound.debounceMs`) per session so rapid-fire user messages merge gracefully into a single conversational block before being sent to the LLM queue.
