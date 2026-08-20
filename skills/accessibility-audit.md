---
name: accessibility-audit
description: Accessibility audit — check semantics, keyboard support, contrast, and screen-reader output, and report findings ranked by user impact.
category: Development
version: 1.0.0
---

# Accessibility Audit

Use this skill whenever asked to review a UI, page, or component for accessibility.

## What to check

- **Semantics.** Real elements over divs: buttons are `<button>`, links are `<a href>`, landmarks exist, headings have a logical order with no skipped levels.
- **Keyboard.** Everything reachable and operable with Tab alone — focus is visible at all times, no keyboard traps, dialogs trap and restore focus, custom controls implement arrow-key patterns.
- **Contrast.** Body text ≥ 4.5:1, large text ≥ 3:1, including placeholders, borders that carry information, and focus indicators.
- **Screen reader.** Every image has a purpose: meaningful alt text or `alt=""` for decoration. Forms have labels; icons that convey meaning have accessible names; live regions announce dynamic changes.
- **Motion & time.** `prefers-reduced-motion` honored; no content that auto-advances without a pause control; no information conveyed by color alone.
- **Target size & touch.** Interactive targets ≥ 24px (44px for primary mobile controls), no overlapping hit areas.

## Method

- Run automated checks first (axe/Lighthouse) as a floor, then verify the critical paths manually — automation misses most real failures.
- Test with a screen reader (VoiceOver/NVDA) for the flows users actually do: sign in, create, save, delete.
- Reproduce at 200% zoom and with a 320px viewport to catch layout-based barriers.

## Output

Findings ranked by user impact (critical / major / minor), each with: what fails, who it hurts, the WCAG criterion, and a concrete fix. End with the checks that passed.
