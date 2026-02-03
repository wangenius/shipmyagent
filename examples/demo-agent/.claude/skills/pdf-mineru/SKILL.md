---
name: pdf-mineru
description: Parse PDFs into Markdown/JSON via 302.ai MinerU-2.5 (create task -> poll -> download zip). Use when you need reliable PDF text/OCR/table/layout extraction, or when the user mentions MinerU / 302.ai / PDF 解析 / OCR / extract/task.
---

# PDF Parsing via MinerU-2.5 (302.ai)

Use 302.ai’s MinerU-2.5 API to convert a PDF (by URL) into a downloadable ZIP containing Markdown and structured outputs.

## Prerequisites

- A 302.ai API key (Bearer token). Set `MINERU_API_KEY`.
- The PDF must be reachable by 302.ai via a URL (`https://.../file.pdf`).
  - If the user only has a local PDF, you must first upload it to a location accessible by 302.ai (object storage / temporary public link / etc.).

## Avoid Prompt Explosion (important)

MinerU is async (create → poll → download). Do NOT model polling as multiple LLM steps.

Instead, run a single deterministic script in **one** `exec_shell` call (with a long timeout).

## Quickstart

1. Submit + wait + download + unzip:
   - `MINERU_API_KEY=... node scripts/mineru_extract_url.cjs --url https://example.com/file.pdf --timeout-ms 900000`
2. Inspect outputs:
   - By default, outputs go to `.ship/downloads/`:
     - `.ship/downloads/mineru-<task_id>.zip`
     - `.ship/downloads/mineru-<task_id>/`
   - You can override with `--out <dir>`.

## What You Get

- A task-based workflow:
  - Create task → poll status → download `full_zip_url` → unzip.
- Output files depend on MinerU’s backend, but typically include at least:
  - One or more `*.md` files (Markdown)
  - One or more `*.json` files (structured extraction)

## API Reference

For the exact endpoints, request/response fields, and examples, read:
- `references/302-mineru-api.md`
