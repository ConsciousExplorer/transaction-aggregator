# Load test

A [k6](https://grafana.com/docs/k6/latest/) test that sends realistic, randomised traffic to the transaction API and reports how much it handles.

## What it does

Each k6 iteration is one customer using the banking portal. It makes the same API calls the portal makes for each page:

1. **Overview**: categories, a spending summary and a monthly summary, sent in parallel.
2. **Transactions** (most sessions): one page of the list, sometimes filtered or sorted oldest first. Some users then page on, open a transaction, or re-categorise one and reset it.
3. **Categories** (a few sessions): remap one category to another, and sometimes undo it.

Each session picks a random customer and period, and pauses one to five seconds between pages. New sessions start at a fixed rate whether or not the API keeps up, so a slow API shows up as higher latency.

Every response is checked. Every request is tagged with its route, so the summary shows a p95 for each endpoint.

## Profiles

| Profile | What it does | Passes when |
| --- | --- | --- |
| `smoke` | 5 sessions, to check the script works | every check passes |
| `load` (default) | 10 sessions/s (about 50 req/s) for 10 minutes | p95 < 200 ms, failures < 1% |
| `breakpoint` | raises the rate every minute for 12 minutes, up to about 370 req/s | it stops itself once failures pass 5% or p95 passes 1 s |

## Run it

You need k6 installed on the host (`brew install k6`). Start the stack from the repo root and wait for the producers to finish (`make ps` shows them `exited (0)`):

```sh
make up-all                         # or make up; up-all adds Grafana
make produce-load-data              # about 5M more rows; the latency target assumes a 5M-row database
make load LOAD_PROFILE=smoke        # check the script first
make load                           # the 10-minute run
make load LOAD_PROFILE=breakpoint   # find where the API slows down
```

`make load` does three things:

1. Recreates the API at log level `info` with tracing off, so neither slows it down. The next `make up` puts both back.
2. Writes the customer ids from Postgres to `users.txt`.
3. Runs k6.

While k6 runs, a live dashboard is at http://127.0.0.1:5665. The same report is saved to `results/` as HTML. Commit the runs worth keeping.

To run k6 yourself, `users.txt` must already exist. Settings are passed with `-e`:

```sh
k6 run -e LOAD_PROFILE=load -e SESSION_RATE=15 loadtests/user-sessions.ts
```

| Setting | Default |
| --- | --- |
| `LOAD_PROFILE` | `load` |
| `SESSION_RATE` | `10` new sessions a second (`load` only) |
| `BASE_URL` | `http://localhost:8083` |
| `ANCHOR_DATE` | the day `make up`'s data ends; `make load` passes the Makefile's `ANCHOR_DATE` |

The token comes from Keycloak's `banking-portal` client. It lasts 15 minutes, so no profile runs longer than that.

## Editing the script

How often each step happens is set by the constants at the top of [user-sessions.ts](user-sessions.ts). To typecheck after a change:

```sh
cd loadtests && npm install && npm run check
```

k6 runs the TypeScript directly; `npm install` only adds the types for the editor and the check.

## On macOS

With Rancher Desktop, `breakpoint` can stop at about 300 concurrent sessions (around 270 req/s), and the limit is the Mac, not the API. Every published port goes through one `ssh` process, which macOS limits to 256 open files. When it dies, k6 reports `connection refused` and `docker` can't reach the daemon, though every container keeps running. Restart Rancher Desktop to recover. Read the API's side of the run from Grafana, which runs inside the VM.
