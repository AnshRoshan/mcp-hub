---
name: prompt-engineering
description: Write effective prompts for AI agents — give context, constrain the output, and iterate based on what the model gets wrong.
category: General
version: 1.0.0
---

# Prompt Engineering

Use this skill whenever writing or improving a prompt for an AI model or agent.

## Anatomy of a good prompt

- **Give the model the context it needs.** What is the task, what is the environment, what does success look like? A model cannot ask questions — anticipate what it would ask.
- **State the constraint, not the technique.** "Return JSON with exactly these fields" beats "be concise and structured". Constraints are checkable; advice is not.
- **Provide examples.** One concrete input→output pair is worth three paragraphs of description. Use few-shot examples when the format matters.
- **Scope the work.** Tell the model what to do AND what not to touch: "Fix the bug; do not refactor unrelated code."
- **Ask for the verification.** "Run the typecheck and tests, and report the results" produces accountable work.

## Iterating

- **Diagnose the failure mode.** Wrong format? Wrong scope? Hallucinated facts? Each failure maps to a prompt fix: add a format constraint, narrow the scope, require citing sources.
- **One variable at a time.** Change one part of the prompt per attempt, and keep a version history — prompt diffs behave like code diffs.
- **Make the prompt self-auditing.** Ask the model to list assumptions and state uncertainty; calibrated models surface what they do not know.
- **Prompt drift is real.** Re-test prompts after model or tooling upgrades; a prompt that worked last month may silently regress.

## For agent skills

- Write skills as decision procedures: when to use them, the ordered steps, the rules that are non-negotiable, and the output format — so any agent follows them identically.
