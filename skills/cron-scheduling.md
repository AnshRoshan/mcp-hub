---
name: cron-scheduling
description: Design and verify crontab schedules — UTC-vs-local traps, the next-run math with cron_parse, and choosing between cron, systemd timers, and at.
category: Operations
version: 1.0.0
---

# Cron Scheduling

Use this skill for any "run this every …" / scheduling request.

## Process

1. **Pin down the semantics first.** Ask (or decide) three things: which timezone, what happens if a run overlaps the next start, and what "missed while the machine was off" should do (skip vs catch up).
2. **Write the expression, then verify it with `cron_parse`.** Never ship a cron line that hasn't been explained back — `0 9 * * 1-5` is 09:00 UTC weekdays, not 9am local, unless `CRON_TZ=` or the system timezone says otherwise.
3. **Check the next 3–5 runs** from `cron_parse` against the user's expectation out loud ("next: Mon 09:00 UTC — that's 2am in Karachi; want me to shift it?").
4. **Guard the job itself:** lock against overlap (`flock -n /run/job.lock command …`), absolute paths (cron's PATH is minimal), and a non-empty audit trail (append stdout/stderr to a log or a mailto).

## Cheat points

- Day-of-month AND day-of-week both restricted → they OR together; that surprises everyone. Use one, `*` the other.
- `*/n` in the hour field means "hours divisible by n", not "every n hours from now".
- `@reboot`, `@daily`, `@hourly` are crontab sugar — systemd uses `OnCalendar=` instead.
- Need catch-up after downtime or second-granularity? Prefer a systemd timer (`Persistent=true`) over cron.
- One-shot future task? `at 03:00 tomorrow` beats a cron line you'll forget to delete.
