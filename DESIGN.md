---
name: MCP Workstation
description: A professional control room built on Meta's Astryx design system — quiet neutral dark surfaces, system type, one accent, and precise Astryx components throughout.
colors:
  body: "#1b1b1b"
  surface: "#262626"
  card: "#1b1b1b"
  popover: "#1b1b1b"
  text: "#fafafa"
  text-secondary: "#a3a3a3"
  text-disabled: "#525252"
  accent: "#ebebeb"
  on-accent: "#171717"
  border: "rgba(255, 255, 255, 0.10)"
  border-emphasized: "#525252"
  success: "#9fe59b"
  warning: "#fdcf4f"
  error: "#ffc6c1"
  blue-vivid: "#a0caff"
  green-vivid: "#9fe59b"
  purple-vivid: "#efa8ff"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    textTransform: "uppercase"
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace"
    fontSize: "0.9em"
rounded:
  container: "12px"
  element: "8px"
  inner: "6px"
spacing:
  base: "4px"
  cardPadding: "16px"
  contentPadding: "24px"
  gridGap: "14px"
components:
  card:
    background: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.container}"
    border: "1px solid {colors.border}"
  button-primary:
    background: "{colors.accent}"
    textColor: "{colors.on-accent}"
  button-secondary:
    background: "{colors.surface}"
    textColor: "{colors.text}"
    border: "1px solid {colors.border}"
  input:
    background: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.element}"
    border: "1px solid {colors.border}"
---

# Design System: MCP Workstation

## Overview

**Creative North Star: "The Professional Control Room"**

MCP Workstation is a dark, calm, professional dashboard built on **Meta's Astryx design
system** (the Neutral theme, forced dark). Every surface is a quiet neutral — the page
paints `#1b1b1b`, content sits on `#262626`, cards on `#1b1b1b` with hairline borders —
so the *data* is the loudest thing on screen. There is no glass, no glow, no aurora, no
decorative gradient: the previous liquid-glass observatory was rejected as unprofessional.
Trust comes from restraint — system type, a strict neutral palette, one semantic accent,
and Astryx's own motion (pressed buttons, toggled switches, expanding dialogs).

The product's one mark is the ⚡ bolt (product brand commitment), shown in the nav logo
and favicon; it never becomes a decorative motif.

**Key Characteristics:**
- **Astryx everywhere** — every control, surface, and overlay is an Astryx component
  (AppShell, TopNav, SideNav, Card, Button, Switch, Dialog, AlertDialog, CodeBlock,
  TabList, MetadataList, Banner, EmptyState, StatusDot, Avatar, DropdownMenu, Collapsible,
  TextInput/TextArea). No hand-rolled UI primitives.
- **Dark by default** — `Theme mode="dark"` + `data-theme="dark"` on `<html>`; the theme's
  `light-dark()` tokens resolve to the dark branch.
- **Two-tone depth** — the shell is `variant="elevated"`: wash nav over a `surface`
  content column; hairline borders do the separation, never shadows.
- **System type** — the Neutral theme ships with system fonts; no webfont download.
- **Semantic color only** — green = on/connected, amber = needs setup, red = destructive;
  every other pixel is neutral gray.
- **Precise state** — Astryx toggles, pressed buttons, focus rings, and dialog
  transitions; `prefers-reduced-motion` collapses them.

## Colors

The palette is Astryx Neutral in dark mode. All values come from the theme tokens
(`--color-*`) — nothing is hard-coded in components.

### Primary
- **Body `#1b1b1b`** — page background (painted on `html`/`body`, not just the shell, so
  overscroll and dialogs stay clean).
- **Surface `#262626`** — the elevated content column, inputs, secondary buttons, pills.
- **Card `#1b1b1b`** — cards sit one step darker than the content column they float on.

### Text
- **Primary `#fafafa`**, **Secondary `#a3a3a3`**, **Disabled `#525252`**. Code and
  endpoints use the primary text with the mono stack.

### Accent
- The Neutral theme's accent is near-white (`#ebebeb`) — primary buttons are white with
  dark text (`on-accent #171717`). This is deliberately monochrome; the accent is
  reserved for the primary action, not decoration.

### Status
- **Success `#9fe59b`** — "on", connected, saved.
- **Warning `#fdcf4f`** — needs setup, platform off.
- **Error `#ffc6c1`** — failures and destructive actions (Sign out, Delete, Revoke).

### Named Rules
**The Restraint Rule.** If an element isn't data, state, or the primary action, it's a
neutral gray. Color is a signal, never a theme.

**The Clean-Canvas Rule.** The page background must be painted at the document level
(`html`/`body` use `--color-background-body`), so load, overscroll, and dialogs never
flash a raw canvas.

## Typography

**System stack** — `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`, with
`ui-monospace` for code. No webfonts: instant paint, native rendering.

### Hierarchy
- **Heading level 2** (page titles) — bold, ~20px.
- **Heading level 4/5** (cards, category sections).
- **Body / supporting** — Astryx `Text` types; supporting is the muted register.
- **Label** — 11px semibold uppercase with tracking, used sparingly (stat captions).
- **Mono** — endpoints, configs, tool names, route codes (`TIM`, `SRV`, …), timestamps.

### Named Rules
**The Tabular Rule.** Numerals in readouts use `tabular-nums` so stat values never jiggle.
**The Mono Register.** Mono is the code register only — endpoints, commands, tool names.

## Layout

**AppShell** (`variant="elevated"`, `contentPadding={6}`): a `TopNav` (logo, Endpoint
button, connected status, user menu) over a collapsible `SideNav` (Console / Discover /
Manage / Account sections). On mobile the SideNav becomes a drawer with the AppShell's
built-in toggle; the top nav keeps logo, status, endpoint, and profile in reach.

Content: 24px gutters, 14px grid gaps. Stat grid is 4 columns (2 on tablet, 2 on phone);
directory and skills cards auto-fill at `md:grid-cols-2` / `2xl:grid-cols-3`; connect is
`340px + 1fr` collapsing to 1 column.

## Surfaces & Depth

Depth is two tones and hairline borders, not shadows. The `elevated` shell draws the
content column in `surface` over the `body` wash; cards are `card`-toned with a 1px
border and 12px radius. Dialogs float above an overlay (`--color-overlay`); toasts stack
in the Astryx `ToastViewport` bottom-end with their enter/exit motion.

## Components

- **Buttons** — Astryx variants: `primary` (white/dark), `secondary`, `ghost`,
  `destructive`; `isLoading` spinners; icon + label everywhere it helps.
- **Cards** — `Card` with the padding scale; `variant="muted"` for de-emphasized tiles,
  `variant="green"`/`"red"` only for the new-token reveal and the account/danger card.
- **Inputs** — Astryx `TextInput` / `TextArea` with labels, required/optional markers,
  descriptions, and status states; native `<select>` styled with the same tokens for
  category/type pickers (Astryx has no plain Select).
- **Switches** — Astryx `Switch` for server on/off, module and per-tool toggles, skills.
- **Badges / tags** — Astryx `Badge` with semantic variants (success for "on", warning
  for "needs setup") and hue variants for directory provenance (blue stdio, green
  official, purple http, neutral reference/community).
- **Dialogs** — `Dialog` + `DialogHeader` for the skill preview; `AlertDialog` for every
  destructive confirmation (delete server, revoke token). No `window.confirm`.
- **Code** — `CodeBlock` (copy button, line numbers, max-height scroll) for skill
  previews and connect-guide configs.
- **Empty states** — `EmptyState` with an icon and an action when there's an obvious one.
- **Toasts** — Astryx `ToastViewport` + `useToast`, fed from the store's message bus.
- **Metadata** — `MetadataList` for the System card, endpoint/auth rows, and About.

## Motion

Astryx's built-in motion only: button presses, switch throws, dialog/dropdown popovers,
toast enter/exit. No authored choreography — motion exists to make state legible, never
to entertain. `prefers-reduced-motion` is respected via the Astryx + Tailwind cascade.

## Implementation

The dashboard is a **React 19 SPA** (source in `web/`, built into `public/` with Vite +
Tailwind CSS v4 for the Node backend to serve unchanged). All components come from
`@astryxdesign/core` with the `@astryxdesign/theme-neutral` theme, wrapped in
`<Theme theme={neutralTheme} mode="dark">` in `main.tsx`. The Tailwind entry imports the
Astryx CSS cascade in layer order (reset → preflight → astryx → theme → utilities) plus
the `tailwind-theme.css` bridge, so layout uses utilities like `bg-surface`,
`border-border`, and `text-secondary` backed by theme tokens. Icons are **lucide-react**
(the Neutral theme's icon family), passed straight to Astryx `icon` props. The only
hand-written CSS is the page background paint, scrollbars, and the scrollbar-less pill
row utility. Astryx, React, and the app are split into cached build chunks.

## Do's and Don'ts

### Do:
- **Do** use Astryx components for every control — never roll your own button, switch,
  dialog, or badge.
- **Do** keep the page background painted at the document level so the canvas is always
  the theme body color.
- **Do** reserve color for state: green = on, amber = needs setup, red = destructive.
- **Do** put the primary action in the accent (white) button and everything else in
  secondary/ghost.
- **Do** use mono for endpoints, commands, and tool names; tabular numerals in readouts.

### Don't:
- **Don't** add glass, glow, gradients, or decorative motion — the design is quiet on
  purpose.
- **Don't** tint a card or panel to show state; use the semantic badge/switch.
- **Don't** use red except for destructive actions and errors.
- **Don't** hard-code colors in components — read the theme tokens through the Tailwind
  bridge.
- **Don't** replace destructive confirmations with `window.confirm`.
