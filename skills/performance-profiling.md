---
name: performance-profiling
description: Performance investigation — measure before optimizing, profile to find the real bottleneck, and verify every change with numbers.
category: Development
version: 1.0.0
---

# Performance Profiling

Use this skill whenever something is slow: a request, a query, a page, a build, or a batch job.

## The method

1. **Define the target.** What is "slow"? Pick a measurable metric (p50/p95 latency, throughput, memory, bundle size) and a realistic workload. Without a number, there is no performance work.
2. **Measure first — always.** Reproduce the slowness, then profile: a profiler (CPU/memory), timing instrumentation, `EXPLAIN ANALYZE`, browser performance traces, build timings. Identify the actual hotspot.
3. **Form one hypothesis** about the cause (N+1 query, quadratic loop, blocking I/O, re-render storm, cache misses) and confirm it in the profile before changing anything.
4. **Apply the smallest fix** that targets the confirmed hotspot.
5. **Re-measure the same workload.** The change is real only if the number moved. Keep the fix only if it moved in the right direction without breaking correctness.

## Rules

- **Never optimize blind.** No profile, no change — a guess that speeds nothing up still costs review time and complexity.
- **Beware premature optimization.** Hot code matters; cold paths deserve clarity instead.
- **Watch for asymptotic wins first.** An O(n²) → O(n log n) fix beats ten constant-factor tweaks.
- **Benchmark honestly:** warmups, enough iterations, comparable inputs, same machine. Report the methodology with the numbers.
- **Complexity is a cost too.** If the gain is under ~10%, the added complexity usually is not worth it.

## Output

Report: the measured baseline, the confirmed bottleneck, the change, and the measured result — before and after.
