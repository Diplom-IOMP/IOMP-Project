# Fixtures

Golden requests and expected responses. The platform replays each request and compares its answer with `response`; the agent's mock IOMP returns `response` as recorded and the agent checks that it builds the same request.

## File format

| Field | Meaning |
| --- | --- |
| `description` | What the fixture proves and what the client does with the answer. |
| `preconditions` | Fixtures that must be replayed first, in order, against the same store. Empty means a fresh store. |
| `server_time` | Optional. The server clock during the replay. Without it, every timestamp in the request is in the past and within any freshness window. |
| `request` | `method`, `path`, `headers` and `body`. When `body` is `null`, `body_generator` describes how to build it. |
| `response` | `status`, the headers that matter and `body`. |

## Independence

- Each fixture runs on a fresh store after its preconditions only. Order between unrelated fixtures does not matter.
- Every fixture has its own `Idempotency-Key`. A fixture shares a key only with a fixture in its `preconditions`, and only to test key reuse (`409-idempotency-conflict`).
- A `source_event_id` repeats only when the fixture tests deduplication or an alert cycle against a precondition (`202-partial`, `202-condition-cleared`).

## Comparing responses

The server generates some values, so the platform compares them by format, not by value:

| Field | Rule |
| --- | --- |
| `receipt_id`, `request_id` | A UUID. |
| `event_id` of an `Accepted` item | A UUID not returned before for another event. |
| `event_id` of a `Duplicate` item | Equal to the `event_id` the server returned for the same `source_event_id` while replaying the preconditions. |
| `ingestion_timestamp` | An RFC 3339 date-time, not earlier than `server_time` when it is set. |
| `Retry-After` | Present, a positive integer number of seconds. |
| Problem `title` and `detail`, item `error.detail` | Human text: present, any value. |

Everything else is compared literally: status codes, `Content-Type`, counts, `items` order and their `index`, `source_event_id` and `status`, `error.code`, `error.retryable` and `error.field`, and problem `type`, `status`, `code`, `instance` and `errors[].field`/`errors[].code`.

The agent's mock returns the recorded values as they are.
