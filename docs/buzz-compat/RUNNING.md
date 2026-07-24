# Running Peek + the Nostr stack on your machine

For the `feat/nostr-emit` branch on Windows 11 + WSL Ubuntu. Every command below
was run on your machine and works.

The root [`HOW-TO-RUN.md`](../../HOW-TO-RUN.md) covers plain Peek against the
**cloud** Convex deployment. This covers the branch setup, which runs
**everything locally** — no cloud account, no login, nothing to pay for.

---

## What's running, and why

Four things. Two are required, two are optional.

| # | What | Where | Needed for |
| --- | --- | --- | --- |
| 1 | **Convex backend** — Peek's database | `:3210` | **Required.** Peek is blank without it |
| 2 | **Peek** — the app itself | `:5173` | **Required** |
| 3 | **Buzz relay** — the Nostr server | `:3000` | Optional. Without it Peek works normally, it just doesn't publish |
| 4 | **Taskboard demo** — the second app | `:5180` | Optional. Only for the interop demo |

**All commands run inside Ubuntu** (where Claude Code runs). You open the pages
in your normal Windows browser — Windows can reach these ports, verified.

---

## Starting from scratch (after a reboot)

Each of these needs **its own terminal tab**, left running. Order matters only
for #3 — the relay needs Docker Desktop up first.

### 1. Convex — Peek's database

```bash
cd ~/peek-app && CONVEX_AGENT_MODE=anonymous npx convex dev
```

`CONVEX_AGENT_MODE=anonymous` is the important bit: it runs Convex **entirely on
your machine** with no account and no cloud deployment. Data lives in
`~/peek-app/.convex`.

Wait for `Convex functions ready!`

### 2. Peek

```bash
cd ~/peek-app && npm run dev
```

Then open **http://localhost:5173**

### 3. Buzz relay *(optional)*

Start **Docker Desktop** on Windows first and wait for the whale icon to settle.
Then:

```bash
cd ~/buzz && ./bin/just relay
```

Wait for it to stop printing. Check it with:

```bash
curl -H 'Accept: application/nostr+json' http://localhost:3000/
```

### 4. Taskboard demo *(optional)*

```bash
cd ~/peek-app/docs/buzz-compat/demo && python3 -m http.server 5180
```

Then open **http://localhost:5180**

---

## Signing in

Peek asks you to sign in. Two ways:

**A — Sign up as yourself.** Click *Create account*, use any email and password.
Nothing is sent anywhere; the account lives in your local database. You'll see
the seeded Topics, but not the demo DMs, because those belong to a different
person.

**B — Reset to the full demo dataset with a ready-made login.** This gives the
complete intended experience (Cath's conversations, DMs, everything):

```bash
cd ~/peek-app && CONVEX_AGENT_MODE=anonymous \
  npx convex run dev/seedDemo:seedWithLogin '{"wipe": true}'
```

Then sign in as **demo@peek.dev** / **Peek-demo-1**

> ⚠️ **`wipe: true` erases the database first**, including anything published to
> Nostr so far and the channel ids the taskboard demo points at. Fine to do —
> new messages republish automatically — but you'll need a fresh channel id for
> the demo (see below).

---

## Seeing the Nostr integration work

With all four running:

1. **In Peek**, open a Topic and send a message.
2. Find the channel id that topic maps to:
   ```bash
   cd ~/peek-app && CONVEX_AGENT_MODE=anonymous npx convex data topics
   ```
   Copy a value from the `channelUuid` column.
3. **In the taskboard** (http://localhost:5180), paste it into the *channel*
   box. Your Peek message appears there as a task.
4. Add a task in the taskboard. **Within about 30 seconds it appears in Peek**
   as a message — that's the sync cron pulling it back.

That round trip is the whole point: two apps, no integration between them, one
shared channel.

---

## Turning the Nostr side off

Publishing is controlled by one setting. To stop Peek touching the relay at all:

```bash
cd ~/peek-app && CONVEX_AGENT_MODE=anonymous npx convex env remove NOSTR_RELAY_URL
```

Peek then behaves exactly as it did before this branch. To turn it back on:

```bash
CONVEX_AGENT_MODE=anonymous npx convex env set NOSTR_RELAY_URL http://localhost:3000
```

---

## If something looks wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Peek page is blank / spinner forever | Convex (#1) isn't running | Start it; wait for `Convex functions ready!` |
| `permission denied … docker.sock` | Terminal opened before Docker Desktop was installed | Close the terminal, open a new one |
| Relay `curl` fails | Docker Desktop not started | Start it, wait for the whale icon, retry `./bin/just relay` |
| Taskboard says *relay error* | Relay isn't running, or the channel box is empty/wrong | Check #3, re-copy a `channelUuid` |
| Messages don't cross between apps | `NOSTR_RELAY_URL` unset, or both are on different channels | Check the env var and that the channel ids match |
| Peek works but nothing reaches the relay | Expected for **old** messages — the relay rejects anything older than 15 minutes | Send a new message. See [FRICTION.md](FRICTION.md) A1 |

**Checking what's alive:**

```bash
curl -s -o /dev/null -w 'convex   %{http_code}\n' http://localhost:3210/version
curl -s -o /dev/null -w 'peek     %{http_code}\n' http://localhost:5173/
curl -s -o /dev/null -w 'relay    %{http_code}\n' http://localhost:3000/
curl -s -o /dev/null -w 'taskboard %{http_code}\n' http://localhost:5180/
```

`200` means alive.

---

## Notes

- **The local Convex database is separate from your cloud one**
  (`hallowed-stork-966`). Nothing here touches it. `.env.local` on this branch
  points at the local backend; delete it to go back to cloud.
- **Nothing here is on the internet.** Every service is local to your machine.
- **The relay's data survives restarts** (it's in Docker volumes). To wipe it:
  `cd ~/buzz && docker compose down -v`
