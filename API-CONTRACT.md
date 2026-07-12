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
- The client times out requests after 4 s. Reads are stale-while-revalidate:
  cached data is shown immediately and refreshed in the background, so a slow
  or dead route degrades to "stale" rather than blocking the UI.

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
| GET | `/api/inbox` | unprocessed notes, oldest first | `InboxResponse` — [`schemas/inbox.ts`](src/schemas/inbox.ts) |
| GET | `/api/briefs` | brief list, newest first (≤90 days) | `BriefsResponse` — [`schemas/briefs.ts`](src/schemas/briefs.ts) |
| GET | `/api/briefs/{id}` | one brief with its Markdown body | `BriefDetail` — [`schemas/briefs.ts`](src/schemas/briefs.ts) |
| GET | `/api/someday` | parked (deferred) follow-ups | `SomedayResponse` — [`schemas/someday.ts`](src/schemas/someday.ts) |
| GET | `/api/commands` | queued command lifecycle list, newest first | `CommandsResponse` — [`schemas/commands.ts`](src/schemas/commands.ts) |
| GET | `/api/chat/{jobId}` | poll one chat turn until it leaves `running` | `ChatJobResponse` — [`schemas/chat.ts`](src/schemas/chat.ts) |
| GET | `/api/transactions?month=` | month's transaction ledger (additive; **no client schema yet** — the app does not call it, `documents.spentThisMonth` derives from the same ledger server-side) | — |
| GET | `/api/reminders` | dated commitments to mirror into the phone calendar | `RemindersResponse` — [`schemas/reminders.ts`](src/schemas/reminders.ts) |
| GET | `/api/search?q=` | grouped full-text search across all collections | `SearchResponse` — [`schemas/search.ts`](src/schemas/search.ts) |
| POST | `/api/capture` | the **only** general write: drop a note into the agent inbox | `CaptureResponse` — [`schemas/capture.ts`](src/schemas/capture.ts) |
| POST | `/api/notifications` | notification-listener capture (native layer replay) | `NotificationCaptureResponse` — [`schemas/notifications.ts`](src/schemas/notifications.ts) |
| POST | `/api/commands` | queue a command (adhoc digest, person note) | `CommandAccepted` — [`schemas/commands.ts`](src/schemas/commands.ts) |
| POST | `/api/chat` | start (or dedup by `clientId`) a chat turn | `ChatStartResponse` — [`schemas/chat.ts`](src/schemas/chat.ts) |
| POST | `/api/inbox/{id}/triage` | file an inbox note to a destination | `TriageResponse` — [`schemas/inbox.ts`](src/schemas/inbox.ts) |
| POST | `/api/inbox/{id}/untriage` | cancel a still-pending triage (empty body `{}`) | `UntriageResponse` — [`schemas/inbox.ts`](src/schemas/inbox.ts) |
| POST | `/api/memory/{id}/flag` | queue a forget / mark-sensitive request **for the agent** | `FlagResponse` — [`schemas/memory.ts`](src/schemas/memory.ts) |
| POST | `/api/followups/{id}/action` | queue done / snooze / someday, or undo the pending one | `FollowupActionResponse` — [`schemas/followups.ts`](src/schemas/followups.ts) |
| POST | `/api/someday/{id}/action` | queue activate / close, or undo the pending one | `SomedayActionResponse` — [`schemas/someday.ts`](src/schemas/someday.ts) |
| POST | `/api/habits/{id}/tick` | queue a habit tick for a date, or undo the pending one | `HabitTickResponse` — [`schemas/habits.ts`](src/schemas/habits.ts) |
| POST | `/api/sync/ack` | phone confirms it applied a reminders revision | `SyncAckResponse` — [`schemas/sync.ts`](src/schemas/sync.ts) |

## Deploy order (contract evolution)

The app and the sidecar never deploy atomically, so every change follows one
of two orders:

- **New response fields / new response enum values — server first.** The
  client is obliged to tolerate the unknown: response schemas ignore extra
  fields, display enums marked OPEN in `src/schemas/` degrade unknown values
  to a documented safe fallback (`.catch`), `TimelineEvent.kind` is a free
  string, and additive fields are `.optional()`. A new value on a CLOSED
  response enum (protocol statuses like `ok|gone`, `ok|duplicate`, chat and
  command state machines) is a breaking change and needs a coordinated
  release.
- **New request values / request enums — client first (enum-first-in-app).**
  The app ships knowing the new destination/action/type before any server
  accepts it; until the sidecar catches up, the old server's `400` is the
  correct, visible outcome. The same rule covers response fields that merely
  echo queued requests (`pendingAction.action`, command `type`) — client-first
  deployment guarantees the app recognizes everything it can see back.

Every enum in `src/schemas/` carries an explicit OPEN/CLOSED decision comment.

### Semantics that matter

- **`/api/today`** — `deadlines` covers the next 30 days, sorted soonest-first;
  when a document has both `cancelBy` (still in the future) and `renewsOn`, the
  cancel window wins. `agentActivity` is the last 24 h, newest first.
  `inboxCount` must equal the current length of `/api/inbox`.
- **`/api/timeline`** — returns up to 25 events per page, newest first.
  `nextBefore` is the `at` of the last returned event, or `null` when
  exhausted; pass it back as `?before=` to fetch older events. `?category=` is
  one of `agent | memory | capture | habit | document | project | people | system`.
  Events may carry a free-string `kind` (e.g. `notification`,
  `triage-queued`, `followup-queued`, `backup`) — the client routes taps by
  the kinds it knows and expands unknown kinds in place; events without
  `kind` (older sidecar) fall back to title-prefix matching, so the sidecar
  must keep its queued-ack journal titles stable until it stamps `kind`.
- **`/api/status`** — `tokenSpend.since` (additive, optional) is the
  human-readable date tracking started; when present the app captions the
  total with "since <date>" instead of "total tracked".
- **`/api/documents`** — `monthlyTotal` is the recurring spend normalized to
  per-month (yearly amounts divided by 12, rounded to cents), one entry per
  currency, computed server-side.
- **`POST /api/memory/{id}/flag`** — the server must **not** mutate memory.
  It queues the request for the agent to act on and replies
  `{ "status": "pending", "itemId": "…" }`. Until the agent confirms, the item
  is served with `pendingFlag` set.
- **`/api/reminders`** — `items[]` are the dated commitments the phone
  mirrors into its local calendar: `{ id, title, dueAt (ISO-8601 with
  offset), leadTimeMinutes?, notes?, critical: boolean, sourceRef? }`.
  The feed-level `revision` is an **opaque string** that changes whenever any
  item changes; the client skips the whole calendar sync when it matches the
  last applied revision. `critical: true` marks reminders the client must
  never drop silently. `sourceRef` is an opaque pointer back to the
  agent-side source (note/document/project id).
- **`/api/search` and sensitive memory** — results carry a `sensitive`
  boolean. For memory items marked sensitive, the server must match only on
  the `topic` (never the fact text), return an **empty** `snippet`, and set
  `sensitive: true`; the client renders them masked and requires
  biometric/PIN confirmation in the Memory screen to reveal the content.
- **Queued writes and the overlay pattern** — follow-up/someday/habit actions
  and inbox triage do **not** mutate agent data directly: the server drops a
  queue file for the agent and immediately reflects it in reads
  (`pendingAction` on `/api/today` and `/api/someday` items, pending tick
  dates unioned into `/api/habits`, triaged items hidden from `/api/inbox`).
- **`"gone"` is success-by-staleness** — on the followups/someday/habits
  action endpoints and on untriage, `{ "status": "gone" }` means the item no
  longer exists server-side (typically an offline replay landing after the
  agent already resolved it, or an undo arriving after processing). The
  client treats it as success and drops the queued mutation; it is **not** an
  error.
- **`/api/chat`** — POST starts a turn and returns `{ jobId, sessionId,
  status: "running" }` immediately; the client polls `GET /api/chat/{jobId}`
  until `status` leaves `running`. A job lives ~10 min server-side; polling
  an expired/unknown `jobId` returns `404`. Replaying a POST with the same
  `clientId` returns the **same** `jobId` (dedup, no second turn).
- **`/api/commands`** — POST answers `201 { "status": "ok" }` on accept and
  `200 { "status": "duplicate" }` on a ledger replay of the same `clientId`;
  both carry the `commandId`. GET lists command lifecycles
  (`pending → running → done | error`, with `summary`/`result` once done).
- **`/api/briefs`** — the list omits the Markdown body; `GET /api/briefs/{id}`
  returns it (`markdown`, plus `generatedAt` = file mtime). Briefs older than
  90 days are not listed.

## Request bodies

### `POST /api/capture`

```json
{
  "text": "Idea for the novel: the station AI hides log entries",
  "tags": ["novel", "idea"],
  "clientId": "9f4b2c1e-7d31-4c1a-9b64-0a4d5e8f1c22"
}
```

`clientId` is **optional** (additive): a client-generated id that stays the
same across retries of the same capture. See Idempotency below.

→ `201/200`:

```json
{ "status": "ok", "id": "cap-1751628000000", "capturedAt": "2026-07-04T12:00:00+02:00" }
```

### `POST /api/sync/ack`

```json
{ "syncedAt": "2026-07-04T12:00:00+02:00", "lastSeenRevision": "rev-2b7f31" }
```

Sent (through the offline mutation queue) after the phone has applied a
reminders revision to its calendar. Idempotent — acknowledging the same
revision twice is a no-op.

→ `{ "status": "ok" }`

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

### `POST /api/inbox/{id}/untriage`

Empty body (`{}`). Cancels a still-pending triage: the queue file is deleted
and the note reappears in `/api/inbox`.

→ `{ "status": "ok", "itemId": "in-4" }` — or `"gone"` when the agent already
processed the triage.

### `POST /api/followups/{id}/action`

```json
{ "action": "snooze", "until": "2026-07-18" }
```

`action` ∈ `done | snooze | someday` (`until` required for `snooze`), or
`{ "action": "undo" }` to cancel a still-unprocessed pending action.

→ `{ "status": "ok" | "gone", "itemId": "fu-3021" }`

### `POST /api/someday/{id}/action`

```json
{ "action": "activate", "date": "2026-07-20" }
```

`action` ∈ `activate` (with `date`) `| close`, or `{ "action": "undo" }`.

→ `{ "status": "ok" | "gone", "itemId": "sd-12" }`

### `POST /api/habits/{id}/tick`

```json
{ "date": "2026-07-11" }
```

Undo of a still-pending tick: `{ "date": "2026-07-11", "undo": true }`. A date
already written into the habit file cannot be undone — the server answers
`"gone"`.

→ `{ "status": "ok" | "gone", "itemId": "habit-gym" }`

### `POST /api/notifications`

```json
{
  "clientId": "1751955060000-whatsapp-9f3a2b1c",
  "package": "com.whatsapp",
  "postedAt": "2026-07-08T09:31:00+02:00",
  "capturedAt": "2026-07-08T09:31:02+02:00",
  "title": "Clara",
  "text": "See you at 5",
  "bigText": "See you at 5 at the usual place"
}
```

Sent by the native notification listener through the offline queue. The
schema is a **verbatim mirror** shared with the sidecar
([`schemas/notifications.ts`](src/schemas/notifications.ts)) — change both
sides in lockstep or not at all.

→ `{ "status": "ok" | "duplicate", "itemId": "…" }` — `duplicate` = this
`clientId` was already accepted; the client treats both as success.

### `POST /api/commands`

```json
{
  "clientId": "cmd-7f3a2b1c9d04",
  "type": "adhoc-digest",
  "payload": { "topic": "apartment search" }
}
```

`type` ∈ `adhoc-digest | create-note` (discriminated union — see the verbatim
mirror in [`schemas/commands.ts`](src/schemas/commands.ts)).

→ `201 { "status": "ok", "commandId": "…" }` / `200 { "status": "duplicate",
"commandId": "…" }`.

### `POST /api/chat`

```json
{
  "message": "What did I agree with the landlord?",
  "clientId": "turn-9f4b2c1e7d31",
  "sessionId": "sess-42"
}
```

`sessionId` omitted on the very first turn; the response's `sessionId`
continues the rolling session.

→ `{ "jobId": "job-7", "sessionId": "sess-42", "status": "running" }`, then
poll `GET /api/chat/{jobId}` → `{ "jobId", "status", "reply?", "error?",
"finishedAt?", "tokensUsed?" }`.

## Idempotency

The app replays queued mutations after being offline, and a replay can race a
request whose response was lost. Server obligations:

- **capture** — when the body carries a `clientId` the server has already
  accepted, do **not** create a second inbox item: return the same success
  shape (same `id`/`capturedAt`) as the first accept. Captures without
  `clientId` are taken at face value (legacy behavior). The bundled
  MockDataSource implements the same dedup so the behavior is testable
  offline.
- **triage / flag** — acting on an already-processed item returns the same
  success shape as the first call.
- **notifications / commands / chat** — `clientId` is the idempotency key: a
  replay of an already-accepted `clientId` must not create a second
  entry/command/turn. Notifications and commands answer `"duplicate"` (same
  item/command id); chat returns the same `jobId`.
- **followups / someday / habits actions, untriage** — replaying against an
  item the agent already resolved answers `{ "status": "gone" }`, which the
  client also treats as success (see "gone" semantics above).
- **sync-ack** — acknowledging any revision (current or stale) always returns
  `{ "status": "ok" }`; the server just records the latest.

## Example responses

Realistic examples for the read collections (status, timeline, memory,
projects, people, documents, decisions, habits, inbox) live in
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
- Unknown values on OPEN response enums degrade to documented safe fallbacks
  (unknown timeline category → `system`, unknown memory category → `misc`,
  unknown search group → `timeline`, …) instead of failing the parse; CLOSED
  protocol enums (`ok|gone`, `ok|duplicate`, chat/command states) still fail
  loudly. See the Deploy order section and the per-enum comments in
  [`src/schemas/`](src/schemas).
- The client never logs the token and never calls any host other than the
  configured base URL.
- Offline writes are queued on-device and replayed in order on reconnect —
  expect occasional bursts of stale-but-valid capture/triage/flag calls.
