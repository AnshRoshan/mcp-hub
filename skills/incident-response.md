---
name: incident-response
description: Calm, structured incident response — contain first, preserve evidence, communicate clearly, and drive a real root-cause fix with follow-ups.
category: DevOps
version: 1.0.0
---

# Incident Response

Use this skill whenever something is broken in production, a service is down, or an incident is declared.

## The sequence

1. **Contain before you diagnose.** If the fix is obvious and safe, apply it; otherwise stop the bleeding (rollback, feature flag, rate limit) while investigation continues. Restoring service outranks understanding it — temporarily.
2. **Preserve evidence.** Copy logs, stack traces, request IDs, and the exact state before restarting anything. An incident you cannot replay is an incident you cannot fix.
3. **Establish a timeline.** What changed, when, by whom, in what order? The timeline usually reveals the cause. Look at deploys, config changes, traffic spikes, and external dependencies around the onset.
4. **Fix the cause, not the symptom.** A restart that clears the alert is a mitigation, not a resolution. The fix must address the root cause or carry an explicit owner and follow-up issue for the permanent fix.
5. **Verify and communicate.** Confirm recovery with real checks (health, metrics, a smoke test). Tell stakeholders what is happening in plain language: what is broken, what is being done, estimated impact.

## Communication

- Update the incident channel on a regular cadence — silence reads as "we don't know".
- Distinguish **current status** from **facts** from **hypotheses**. Never present a guess as the cause.
- Write a post-incident summary when resolved: timeline, root cause, impact, what was done, and the follow-ups with owners.

## Rules

- No blame in the moment. The goal is a fixed system and learned lessons, not attribution.
- Never delete evidence to "clean up" — archive it with the incident record.
