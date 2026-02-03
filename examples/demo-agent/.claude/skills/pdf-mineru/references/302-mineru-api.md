/**
 * MinerU-2.5 (302.ai) API notes for PDF extraction.
 *
 * Keep this as the “source of truth” for this skill’s scripts and examples.
 * If 302.ai changes the API, update this file first, then adjust scripts.
 */

# 302.ai MinerU-2.5 API (PDF extraction)

## Base URL

- Default: `https://api.302.ai`

## Auth

- Header: `Authorization: Bearer <API_KEY>`
- Content-Type: `application/json`

## Create task

- `POST /mineru/api/v4/extract/task`
- Body (commonly used fields):
  - `url` (string, required): PDF URL reachable by 302.ai
  - `model_version` (string, optional): e.g. `mineru-2.5`
  - `enable_ocr` (boolean, optional)
  - `full_doc_zip` (boolean, optional): request the full output zip
- Response:
  - `task_id` (string)

Example:

```bash
curl -sS -X POST "https://api.302.ai/mineru/api/v4/extract/task" \
  -H "Authorization: Bearer $MINERU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/file.pdf","model_version":"mineru-2.5","full_doc_zip":true}'
```

## View task

- `GET /mineru/api/v4/extract/task/{task_id}`
- Response (key fields you’ll use):
  - `state` (string): typically `pending` / `running` / `done` / `failed` (exact values may vary)
  - `err_msg` (string|null): set when failed
  - `full_zip_url` (string|null): download URL for the full ZIP output (when ready)

Example:

```bash
curl -sS "https://api.302.ai/mineru/api/v4/extract/task/$TASK_ID" \
  -H "Authorization: Bearer $MINERU_API_KEY"
```

## Notes

- The API is URL-based: it does not upload PDF bytes directly.
- `full_zip_url` might be absent until the task completes.
- Task completion semantics can vary; always check `state` and `err_msg`.

