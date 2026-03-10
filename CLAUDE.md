# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CVFilterX is a Chrome Extension (Manifest V3) that automates resume screening on Feishu Hire (飞书招聘). It extracts candidate resumes and job descriptions from the Feishu Hire web interface, sends them to an OpenAI-compatible LLM for multi-dimensional scoring, and overlays results directly on the page.

Target domain: `*.feishu.cn/hire/*`

## Development

This is a vanilla JavaScript Chrome Extension with **no build step, no bundler, no package manager**. Load it directly in Chrome via `chrome://extensions` → "Load unpacked" pointing to the project root.

Testing scripts in `tests/` are Python (Playwright-based) and standalone Node scripts used for DOM inspection and debugging against live Feishu pages. They are not automated test suites — they're manual diagnostic tools.

## Architecture

### Module Communication Pattern

All content scripts share state through a single `window.__cvfx` namespace object. Scripts are loaded in this order (defined in `manifest.json`):

1. **`api-inject.js`** (`document_start`) — Injects `api-interceptor.js` into page context to intercept `fetch` calls to `/evaluation/list_v2` before Feishu's own scripts run. Data is passed to content scripts via `CustomEvent('cvfx:eval-list')`.

2. **`extractor.js`** (`document_idle`) — DOM selectors, URL patterns, page type detection, resume/JD extraction, candidate link collection. Initializes `window.__cvfx` and exports functions onto it.

3. **`overlay.js`** (`document_idle`) — Score overlay component (idle/loading/scored/error states). Pure DOM rendering, no framework.

4. **`paginator.js`** (`document_idle`) — Batch processing controller. Manages task queue in `chrome.storage.local`, navigates between candidates via `window.location.href`.

5. **`content.js`** (`document_idle`) — Main orchestrator. Routes to page-specific logic, triggers scoring, handles SPA navigation by patching `history.pushState/replaceState`.

### Background Service Worker (`background/service-worker.js`)

Message router handling all `chrome.runtime.onMessage` types:
- `SCORE_RESUME` — Builds prompt, calls LLM API, parses JSON response, computes weighted overall score, persists to storage
- `FETCH_JD` — Opens a background tab to scrape JD from `/hire/job/{id}` page
- `CAPTURE_RESUME_IMAGE` — Screenshots visible tab and crops to resume panel (fallback when text extraction yields < 100 chars)
- `TEST_CONNECTION`, `GET_SETTINGS`, `SAVE_SETTINGS`, `GET_SCORES`

### Key Design Decisions

- **API interception dual-path**: Feishu's eval list uses Canvas rendering (no DOM). Primary path intercepts `fetch` via injected page-context script. Fallback directly calls `/atsx/api/evaluation/list_v2/` when garfish sandbox blocks interception.
- **SPA navigation handling**: `history.pushState` and `replaceState` are monkey-patched to detect route changes since Feishu is a SPA.
- **Image fallback**: When extracted resume text is < 100 chars, captures a screenshot and sends it as a vision model input.
- **Score computation**: Overall score is calculated in code (not by LLM) using `Σ(dimension_score × weight) / 10` to avoid model arithmetic errors.
- **No raw resume storage**: Only scores are persisted in `chrome.storage.local`, not original resume text (privacy constraint per SPEC).

### Storage Schema (`chrome.storage.local`)

| Key | Content |
|-----|---------|
| `settings` | API config, field config, dimension config, pagination delay |
| `jobs` | JD cache keyed by jobId (partial flag for incomplete entries) |
| `scores` | Score results keyed by candidateId |
| `taskState` | Batch processing state (queue, progress, statistics) |

### Message Types

Content ↔ Background: `SCORE_RESUME`, `SCORE_RESULT`, `GET_SETTINGS`, `SAVE_SETTINGS`, `TEST_CONNECTION`, `FETCH_JD`, `CAPTURE_RESUME_IMAGE`, `OPEN_OPTIONS`, `GET_SCORES`

Popup ↔ Content: `START_BATCH`, `STOP_BATCH`, `GET_PAGE_TYPE`, `GET_CANDIDATE_COUNT`

Background → Popup: `TASK_PROGRESS`

## DOM Selectors

All Feishu-specific CSS selectors are centralized in `extractor.js` → `SELECTORS` object. Feishu uses dynamic class names (e.g., `[class*="talentDetailTabList"]`), so selectors use substring matching. When Feishu updates its frontend, this is the single file to patch.

## Supported Page Types

| Page | URL Pattern | Behavior |
|------|-------------|----------|
| Candidate detail | `/hire/talent/{id}` | Mount overlay, extract resume, trigger scoring |
| Job detail | `/hire/job/{id}` | Auto-extract and cache JD |
| Evaluation list | `/hire/application-biz/evaluation/list` | Collect candidate links for batch processing |

## LLM Integration Notes

- Compatible with any OpenAI-compatible API (configurable base URL)
- `modelCaps()` in service worker detects o1/o3/o4/gpt-5 series models and adjusts parameters (no temperature, `max_completion_tokens` instead of `max_tokens`)
- Input truncated at 80,000 chars to preserve output token budget
- Retry logic: up to 2 retries on 429/5xx, with exponential backoff and Retry-After header support
- JSON parsing fallback: regex extraction of `{...}` block when response isn't clean JSON
