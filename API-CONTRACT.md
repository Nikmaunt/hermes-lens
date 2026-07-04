# Hermes Lens — API Contract

The read-only JSON API the Hermes Agent (VPS) must expose for the Hermes Lens
phone app. This document is the source of truth for the server implementation;
the client-side zod schemas in [`src/schemas/`](src/schemas) mirror it 1:1 and
validate every payload at runtime. A vitest contract test
([`src/data/mock/contract.test.ts`](src/data/mock/contract.test.ts)) parses the
bundled mock fixtures through the same schemas, so contract, schemas and mock
data cannot silently drift apart.

## Transport & auth

- Reachable **only over the private Tailscale network**. No public exposure.
- Every request carries a static bearer token:
  `Authorization: Bearer <token>`. The server compares it with a constant-time
  check and returns `401` on mismatch.
- All responses are `application/json; charset=utf-8`.
- Timestamps are ISO-8601 **with UTC offset** (e.g. `2026-07-04T09:30:00+02:00`).
  Calendar dates are `YYYY-MM-DD`. Money is integer **cents** + ISO-4217 code.
- The client times out requests after 10 s and falls back to its offline cache.

Error shape (any non-2xx): `{ "error": "<human readable message>" }`.

## Endpoints

| Method | Path | Purpose | zod schema (response) |
|---|---|---|---|
| GET | `/api/status` | agent health: gateway, cron, backup, disk/RAM, token spend | `AgentStatus` — [`schemas/status.ts`](src/schemas/status.ts) |
| GET | `/api/today` | Today summary: follow-ups, deadlines ≤30 d, last-24 h activity, inbox count | `TodaySummary` — [`schemas/today.ts`](src/schemas/today.ts) |
| GET | `/api/timeline?category=&before=` | reverse-chronological event feed, cursor-paginated | `TimelineResponse` — [`schemas/timeline.ts`](src/schemas/timeline.ts) |
| GET | `/api/memory` | everything the agent knows, categorized, with sensitivity | `MemoryResponse` — [`schemas/memory.ts`](src/schemas/memory.ts) |
| GET | `/api/projects` | project cards with status, next action, key dates, linked notes | `ProjectsResponse` — [`schemas/projects.ts`](src/schemas/projects.ts) |
| GET | `/api/people` | person cards: context, agreements, last interaction, language | `PeopleResponse` — [`schemas/people.ts`](src/schemas/people.ts) |
| GET | `/api/documents` | contracts/subscriptions with renewals, cancel-by, monthly total | `DocumentsResponse` — [`schemas/documents.ts`](src/schemas/documents.ts) |
| GET | `/api/decisions?project=` | decision log, optionally filtered by project id | `DecisionsResponse` — [`schemas/decisions.ts`](src/schemas/decisions.ts) |
| GET | `/api/habits` | habit definitions + completed dates (from agent logs) | `HabitsResponse` — [`schemas/habits.ts`](src/schemas/habits.ts) |
| GET | `/api/polish-words` | flashcard word list (review state stays on-device) | `PolishWordsResponse` — [`schemas/polish.ts`](src/schemas/polish.ts) |
| GET | `/api/inbox` | unprocessed notes, oldest first | `InboxResponse` — [`schemas/inbox.ts`](src/schemas/inbox.ts) |
| GET | `/api/search?q=` | grouped full-text search across all collections | `SearchResponse` — [`schemas/search.ts`](src/schemas/search.ts) |
| POST | `/api/capture` | the **only** general write: drop a note into the agent inbox | `CaptureResponse` — [`schemas/capture.ts`](src/schemas/capture.ts) |
| POST | `/api/inbox/{id}/triage` | file an inbox note to a destination | `TriageResponse` — [`schemas/inbox.ts`](src/schemas/inbox.ts) |
| POST | `/api/memory/{id}/flag` | queue a forget / mark-sensitive request **for the agent** | `FlagResponse` — [`schemas/memory.ts`](src/schemas/memory.ts) |

### Semantics that matter

- **`/api/today`** — `deadlines` covers the next 30 days, sorted soonest-first;
  when a document has both `cancelBy` (still in the future) and `renewsOn`, the
  cancel window wins. `agentActivity` is the last 24 h, newest first.
  `inboxCount` must equal the current length of `/api/inbox`.
- **`/api/timeline`** — returns up to 25 events per page, newest first.
  `nextBefore` is the `at` of the last returned event, or `null` when
  exhausted; pass it back as `?before=` to fetch older events. `?category=` is
  one of `agent | memory | capture | habit | document | project | people | system`.
- **`/api/documents`** — `monthlyTotal` is the recurring spend normalized to
  per-month (yearly amounts divided by 12, rounded to cents), one entry per
  currency, computed server-side.
- **`POST /api/memory/{id}/flag`** — the server must **not** mutate memory.
  It queues the request for the agent to act on and replies
  `{ "status": "pending", "itemId": "…" }`. Until the agent confirms, the item
  is served with `pendingFlag` set.
- **Idempotency** — triage and flag on an already-processed item return the
  same success shape (the app retries queued mutations after being offline).
- **`/api/search` and sensitive memory** — results carry a `sensitive`
  boolean. For memory items marked sensitive, the server must match only on
  the `topic` (never the fact text), return an **empty** `snippet`, and set
  `sensitive: true`; the client renders them masked and requires
  biometric/PIN confirmation in the Memory screen to reveal the content.

## Request bodies

### `POST /api/capture`

```json
{ "text": "Idea for the novel: the station AI hides log entries", "tags": ["novel", "idea"] }
```

→ `201/200`:

```json
{ "status": "ok", "id": "cap-1751628000000", "capturedAt": "2026-07-04T12:00:00+02:00" }
```

### `POST /api/inbox/{id}/triage`

```json
{ "destination": "note" }
```

`destination` ∈ `note | task | memory | archive | trash`.

→ `{ "status": "ok", "itemId": "in-4" }`

### `POST /api/memory/{id}/flag`

```json
{ "action": "forget", "reason": "outdated address" }
```

`action` ∈ `forget | mark-sensitive`; `reason` optional.

→ `{ "status": "pending", "itemId": "mem-old-address" }`

## Example responses

Realistic examples for the read collections (status, timeline, memory,
projects, people, documents, decisions, habits, polish-words, inbox) live in
the mock fixtures: [`src/data/mock/fixtures/`](src/data/mock/fixtures). They
use relative date tokens (`@d-3` = 3 days ago, `@t-2@09:15` = timestamp 2 days
ago) that materialize to the ISO formats above — see
[`src/data/mock/materialize.ts`](src/data/mock/materialize.ts); apart from the
tokens, the fixture shapes are exactly what the server should return.

Two endpoints have no standalone fixture: `/api/today` is partially derived
(`today.json` holds only `followUps`; deadlines come from documents within 30
days, activity from the last 24 h of timeline, `inboxCount` from the inbox —
see `MockDataSource.getToday` for the reference algorithm the server should
mirror), and `/api/search` results are built per-query (shape in
[`schemas/search.ts`](src/schemas/search.ts); note the `sensitive` flag below).
POST response shapes are specified in this document.

One abbreviated example (`GET /api/status`):

```json
{
  "gateway": { "alive": true, "lastHeartbeat": "2026-07-04T07:58:00+02:00" },
  "cronJobs": [
    {
      "id": "cron-vault-backup",
      "name": "Vault backup → object storage",
      "schedule": "daily 02:00",
      "lastRun": "2026-07-04T02:00:00+02:00",
      "lastResult": "ok"
    }
  ],
  "lastBackup": {
    "at": "2026-07-04T02:04:00+02:00",
    "sizeBytes": 48234511,
    "target": "s3://hermes-backup/vault"
  },
  "system": {
    "diskUsedBytes": 13314398208,
    "diskTotalBytes": 42949672960,
    "ramUsedBytes": 2040109465,
    "ramTotalBytes": 4294967296,
    "uptimeSeconds": 1580400
  },
  "tokenSpend": { "todayUsd": 0.42, "monthUsd": 8.73 },
  "generatedAt": "2026-07-04T08:00:00+02:00"
}
```

## Client behavior the server can rely on

- Every payload is zod-validated; unknown extra fields are ignored, missing or
  malformed fields make the client treat the response as an error (and fall
  back to its cache), so additive evolution is safe, breaking changes are not.
- The client never logs the token and never calls any host other than the
  configured base URL.
- Offline writes are queued on-device and replayed in order on reconnect —
  expect occasional bursts of stale-but-valid capture/triage/flag calls.
