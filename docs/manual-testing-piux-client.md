---
title: nplan Manual Testing piux_client Notes
summary: Durable notes for when `piux_client` looks broken during live `nplan` testing.
short: `piux_client` failure notes.
read_when:
  - `piux_client` errors during live `nplan` testing.
  - Need to tell tool failure from dead tmux/Pi.
  - Need the fast recovery path for `/tmp/piux`.
---

# nplan Manual Testing piux_client Notes

Most apparent `piux_client` failures are not `piux_client` bugs.

Most of the time the inner tmux session or the Pi process died.

Treat this as the default diagnosis first.

## Fast Check

If `piux_client` says tmux server is missing, check the real tmux session first:

```bash
tmux -L piux ls
tmux -L piux capture-pane -pt piux:pi.0 -S - | tail -40
```

If there is no `piux` session, restart the tmux session.

## Recovery Rule

Prefer restarting the tmux session or pane before assuming the tool is broken.

Good default relaunch shape:

```bash
tmux -L piux respawn-pane -k -t piux:pi.0 \
  "cd /tmp/piux && \
   export PI_CODING_AGENT_DIR='/tmp/piux/.pi/agent' && \
   export PATH='/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' && \
   /opt/homebrew/bin/pi --no-skills --no-prompt-templates --no-themes --provider opencode-go --model minimax-m2.7; \
   code=\$?; echo EXIT:\$code; sleep 10000"
```

Why this wrapper helps:

- Pi can crash without taking the tmux server away
- the pane stays inspectable
- `piux_client` can reconnect after tmux is back
- you can read the real crash instead of losing the surface

## Relaunch Caveat

Raw `respawn-pane ... pi` is not the same thing as resuming the previous Pi session.

If you relaunch Pi in the pane without an explicit Pi resume flow, you may simply be starting a fresh Pi session.

Do not treat that as `nplan` state-loss proof by itself.

For real session-state testing, prefer:

- `/reload`
- `/resume`
- `/fork`
- `/new`
- `/tree`

## Current Lesson

When `piux_client` broke during this pass, the root cause was a dead tmux server after the inner Pi process exited.

After tmux was rebuilt and Pi was relaunched in `piux:pi.0`, `piux_client` worked again.

## Testing Rule

When this happens during manual testing:

1. note it here
2. verify whether tmux or Pi died
3. restart tmux or the pane
4. only then decide whether there is a real `piux_client` bug