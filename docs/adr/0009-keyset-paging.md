# 0009. Keyset paging with an opaque cursor

- **Status:** Accepted
- **Where it lives:** [`transaction-repository.ts`](../../apps/api/src/integrations/database/repositories/transaction-repository.ts), [`keyset-page.ts`](../../apps/api/src/integrations/database/repositories/keyset-page.ts), [`paging.ts`](../../apps/api/src/utils/paging.ts), [`list-transactions.route.ts`](../../apps/api/src/routes/api/v1/users/_userId/transactions/list-transactions.route.ts)
- **See it:** [keyset-paging.html](keyset-paging.html) (keyset and offset paging side by side, while rows are added and removed)

## Context

A user's transaction list is paged. The consumer keeps inserting while a client pages, often into the middle of the list, because late transactions arrive with old timestamps. Pages must not repeat or skip rows when that happens, and a deep page must cost no more than the first.

## Decision

**Page on the keyset `(occurred_at, transaction_id)`.**

- **The query:** each page seeks past the last row of the previous one with a row comparison, reads `limit + 1` rows from the covering index, and uses the extra row only to know whether there is a next page.
- **One repository call returns the page.** `seekTransactionPage` takes the requested sort, the limit and the decoded cursor. It returns up to `limit` rows in the requested sort, with the cursors of the next and previous pages, or `null` where there is none. The extra row, the read order and the flip all stay inside the repository, so the handler never sees them.
- **`limit`:** defaults to 50, at most 100.
- **Sort:** `-occurredAt` (newest first, the default) or `occurredAt` (oldest first).
  - The repository's `chooseReadSort` picks the order to read in. A next page reads in the requested sort, and a previous page reads in the opposite order.
  - `buildKeysetPage` flips a previous page back, so every page is in the requested sort.
- **Precision:** the cursor carries `occurredAt` to the microsecond, formatted by Postgres. Rows a microsecond apart are never skipped or repeated, even though items show it only to the millisecond.

**The cursor is one opaque query parameter, `cursor`.**

- It is base64url JSON of `{direction, position: {occurredAt, transactionId}}`. The keyset (`position`) and the paging direction are separate parts. The route decodes the cursor and encodes the two it gets back; the SQL only ever sees the keyset and a read order.
- A cursor that doesn't decode to that shape is a 400 `invalid-cursor`.
- It isn't signed. A changed cursor can only move a window over the same user's rows.

**Links are the only way to page.**

- Every list returns `{data, links, meta}`. `links.next` and `links.prev` are relative links that carry the cursor, the sort, every filter as sent, and the date window as parsed, so a whole walk reads one fixed window.
- A link is left out when there is no such page; it is never `null`.
- `:` stays literal in links, so a client that encodes a pasted link again can't break the timestamps.
- `meta` holds the count, limit, sort and window, with no cursor and no total.
- The lists that aren't paged send only `links.self`, so a client handles every list the same way.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| `OFFSET` paging | Page N reads and throws away N × limit rows. Rows inserted while a client pages shift the offsets, so rows repeat or vanish. |
| The cursor as plain parameters (`cursorOccurredAt`, `cursorTransactionId`, `cursorDirection`) | The contract grows with every new sort key, and clients start building cursors by hand. |
| A signed (HMAC) cursor | It means key management for no threat: the user is already in the path, so a forged cursor reaches nothing new. |
| A total count in `meta` | It's a `COUNT(*)` over the whole window on every request, which is the full scan keyset paging avoids, and it drifts during ingest. |
| Absolute URLs or a `Link` header | The API would have to know its public host, scheme and gateway prefix. |
| Cursor fields in `meta` beside the links | Two ways to page, which had already drifted apart once. |
| The handler runs the paging: it asks the repository for `limit + 1` rows, trims and flips them, and builds the cursors | `limit` means one thing to the client and another to the repository, and the handler has to know how the query is read. |
| `sort=amount` | People filter by amount, category and date far more than they re-sort. An amount order also needs a keyset of its own, `(amount_minor, occurred_at, transaction_id)`. |

## Consequences

- **Every page costs the same:** an index range starting at the cursor, however deep the client has paged.
- **Inserts don't disturb a walk:** a new row lands on one side of the cursor or the other, and is never repeated or skipped.
- **No jumping to page N:** keyset paging has no page numbers, so a client can't skip ahead and doesn't know the total.
- **Cursors aren't tied to their query:** a cursor isn't checked against the sort or filters it was made with. Reused with different parameters, it pages from that position under the new ones.
- **The route's test can't see the read order:** its fake repository returns a finished page. The read order and the page trimming have unit tests of their own, and the integration suite walks real pages forwards and back in both sorts.
- **Gateway prefixes break the links:** if a gateway rewrites the path prefix, the relative links still carry the API's own path.
