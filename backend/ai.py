"""Provider-agnostic LLM client (OpenAI-compatible Chat Completions API).

Configure with environment variables — nothing is hardcoded:
  AI_API_KEY   provider key. Falls back to EMERGENT_LLM_KEY if AI_API_KEY is unset.
  AI_BASE_URL  OpenAI-compatible endpoint. Examples:
                 Emergent Universal Key proxy : https://integrations.emergentagent.com/llm
                 Anthropic (OpenAI-compatible): https://api.anthropic.com/v1/
                 OpenAI                       : leave empty
  AI_MODEL     e.g. claude-sonnet-4-5-20250929 (Emergent/Anthropic) or gpt-4.1 (OpenAI)
If no key/model is configured, enabled() is False and callers fall back (rules-based scoring, 503 for chat).
"""
import asyncio
import os
from typing import AsyncIterator, Optional

from openai import AsyncOpenAI

_client: Optional[AsyncOpenAI] = None
_client_loop: Optional[asyncio.AbstractEventLoop] = None


def _key() -> Optional[str]:
    return os.environ.get("AI_API_KEY") or os.environ.get("EMERGENT_LLM_KEY")


def enabled() -> bool:
    return bool(_key() and os.environ.get("AI_MODEL"))


def _get() -> AsyncOpenAI:
    """The HTTP client is bound to an event loop; rebuild it if the loop changed (serverless re-use)."""
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client_loop is not loop:
        if not enabled():
            raise RuntimeError("AI is not configured: set AI_API_KEY and AI_MODEL")
        _client = AsyncOpenAI(api_key=_key(), base_url=os.environ.get("AI_BASE_URL") or None, timeout=60, max_retries=1)
        _client_loop = loop
    return _client


async def stream(system: str, prompt: str, max_tokens: int = 1200) -> AsyncIterator[str]:
    resp = await _get().chat.completions.create(
        model=os.environ["AI_MODEL"],
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in resp:
        if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def complete(system: str, prompt: str, max_tokens: int = 600) -> str:
    return "".join([t async for t in stream(system, prompt, max_tokens)])
