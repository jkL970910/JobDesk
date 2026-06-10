# Local Model Setup

Status: Implementation note - recommended local provider path for the personal MVP.
Date: 2026-06-09

## Recommendation

Use OpenRouter as the first online provider for quality-sensitive workflows, and
add Ollama as the first local provider for private/offline runs and embeddings.
Keep both behind the same `AIProvider` interface:

- `openrouter`
- `openai_direct`
- `ollama_local`
- `lmstudio_local`
- `mock`

The app should never hard-code one provider into product workflows.

## Option A: Ollama, Recommended

Why:

- Easiest Windows setup.
- Local HTTP API on `localhost:11434`.
- Supports chat, embeddings, streaming, and structured JSON-style outputs.
- Good fit for TypeScript provider adapters.

Install:

```powershell
irm https://ollama.com/install.ps1 | iex
```

Pull starter models:

```powershell
ollama pull qwen3:8b
ollama pull nomic-embed-text
```

Optional stronger local model if hardware allows:

```powershell
ollama pull qwen3:14b
```

Smoke test:

```powershell
ollama run qwen3:8b
```

Embedding smoke test:

```powershell
curl http://localhost:11434/api/embed -d "{\"model\":\"nomic-embed-text\",\"input\":\"resume evidence retrieval test\"}"
```

API shape:

- Chat: `POST http://localhost:11434/api/chat`
- Embeddings: `POST http://localhost:11434/api/embed`
- Structured generation can use Ollama `format` with JSON schema where supported.

References:

- Ollama Windows install: https://ollama.com/download/windows
- Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
- Qwen3 on Ollama: https://ollama.com/library/qwen3
- nomic-embed-text on Ollama: https://ollama.com/library/nomic-embed-text

## Option B: LM Studio

Why:

- Better if you want a GUI for downloading, loading, and benchmarking models.
- Provides OpenAI-compatible endpoints, so the provider adapter can reuse the
same client style as OpenRouter/OpenAI by switching `baseURL`.

Default local URL:

```text
http://localhost:1234/v1
```

Reference:

- LM Studio OpenAI compatibility: https://lmstudio.ai/docs/developer/openai-compat

## Hardware Guide

Minimum practical setup:

- RAM: 16 GB.
- Disk: 20-50 GB free for several 4-bit models and embedding models.
- GPU: optional. CPU-only works for embeddings and small models, but generation
  will be slower.

Comfortable personal MVP setup:

- RAM: 32 GB.
- GPU: NVIDIA GPU with 8-12 GB VRAM, or equivalent.
- Disk: 50-100 GB free.
- Models: 7B/8B for routine local tasks, 14B for better drafting if memory allows.

High-quality local experimentation:

- RAM: 64 GB.
- GPU: 16-24 GB VRAM.
- Models: 30B/32B class quantized models.

## Model Use By Workflow

Use local models for:

- Embeddings and personal RAG.
- JD parsing experiments.
- Low-risk extraction drafts.
- Offline/privacy-sensitive draft exploration.
- Regression tests where deterministic cost matters.

Use OpenRouter/hosted models for:

- Final resume tailoring.
- HR Reviewer.
- Fact Guard Layer B.
- Cover letters and application answers that need high writing quality.
- Company research synthesis.

Keep Fact Guard Layer A as deterministic code regardless of provider.

## MVP Integration Tasks

1. Add `AIProvider` interface with `chat`, `structured`, and `embed` methods.
2. Implement `openrouter` provider first.
3. Implement `ollama_local` provider next.
4. Store provider config in local settings, not in source code.
5. Add per-call logs: provider, model, tokens if available, latency, cost if available.
6. Add fallback policy: local embedding first, hosted model for high-quality generation.
