"""
OpenAI is the only LLM provider in this build. Using the hosted API instead
of a local model (e.g. Ollama) removes the local-inference bottleneck that
caused the read-timeout you were hitting -- there is no local server to warm
up, queue behind, or time out on. Requests here have their own short,
explicit timeout + retry policy instead.
"""
from __future__ import annotations

from openai import OpenAI, AzureOpenAI, APIError, APITimeoutError, APIConnectionError

from . import config

_client: OpenAI | AzureOpenAI | None = None


def get_client():
    global _client
    if _client is None:
        if not config.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set.")
        if config.OPENAI_IS_AZURE:
            # Azure OpenAI / Azure AI Foundry endpoint, e.g.
            # https://<resource>.cognitiveservices.azure.com/
            _client = AzureOpenAI(
                api_key=config.OPENAI_API_KEY,
                azure_endpoint=config.OPENAI_BASE_URL,
                api_version=config.AZURE_OPENAI_API_VERSION,
                timeout=config.OPENAI_TIMEOUT_SECONDS,
                max_retries=config.OPENAI_MAX_RETRIES,
            )
        else:
            _client = OpenAI(
                api_key=config.OPENAI_API_KEY,
                base_url=config.OPENAI_BASE_URL,
                timeout=config.OPENAI_TIMEOUT_SECONDS,
                max_retries=config.OPENAI_MAX_RETRIES,
            )
    return _client


def chat(
    messages: list[dict],
    model: str,
    stream: bool = False,
    temperature: float = 0.0,
    max_tokens: int | None = None,
):
    """Returns the full text (stream=False) or a generator of text chunks
    (stream=True). Raises RuntimeError with a clean message on failure --
    callers should not need to know about the OpenAI SDK's exception types."""
    client = get_client()
    try:
        if not stream:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
            )
            return resp.choices[0].message.content or ""

        def _gen():
            resp_stream = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            for chunk in resp_stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                piece = getattr(delta, "content", None)
                if piece:
                    yield piece

        return _gen()
    except APITimeoutError as e:
        raise RuntimeError(f"OpenAI request timed out after {config.OPENAI_TIMEOUT_SECONDS}s: {e}") from e
    except APIConnectionError as e:
        raise RuntimeError(f"Could not reach OpenAI API: {e}") from e
    except APIError as e:
        raise RuntimeError(f"OpenAI API error: {e}") from e


def is_reachable() -> bool:
    return bool(config.OPENAI_API_KEY)
