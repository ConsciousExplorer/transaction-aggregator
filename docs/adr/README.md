# How it works

Three self-contained HTML pages, each about one part of the system. GitHub shows their source, so open them in a browser after cloning:

```sh
open docs/adr/message-flow.html        # macOS; xdg-open on Linux
```

| Page | What it shows |
| --- | --- |
| [message-flow.html](message-flow.html) | The path of one transaction: generated and produced as Avro, fetched, deserialised, normalised, categorised and inserted, and every branch to the dead-letter topic or to a restart. A table lists what happens to each kind of record, and whether its offset is committed. |
| [consumer-batching.html](consumer-batching.html) | A playable model of the consumer's batching loop: fetches into the stream's buffer, the `for await` loop filling a batch, size and linger flushes, the offset commit, and what a failed flush does. Switch between a backlog, a steady stream and a trickle, or inject a poison record, a bad row or a Postgres outage. |
| [keyset-paging.html](keyset-paging.html) | Keyset paging against offset paging on the same data. Add or remove rows while two clients page, and see which one repeats or loses rows. Also shows what a `links.next` cursor carries, the SQL it runs, and `buildKeysetPage` step by step. |

The pages load their fonts from Google Fonts and need nothing else.
