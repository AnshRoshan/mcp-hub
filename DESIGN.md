---
name: MCP Workstation
description: The Meridian world — a clean precision-instrument console on cool neutrals with one azure accent; color only ever answers a real state.
colors:
  body: "#0b0d12"
  surface: "#10141b"
  card: "#141923"
  popover: "#1a2130"
  muted: "#171c26"
  text: "#e9edf3"
  text-secondary: "#98a2b3"
  text-disabled: "#5b6472"
  accent: "#4f8cff"
  on-accent: "#ffffff"
  border: "rgba(148, 163, 184, 0.13)"
  border-emphasized: "#2b3444"
  go: "#3ecf8e"
  caution: "#f0b429"
  abort: "#f26451"
  telemetry: "#4f8cff"
  day-body: "#f4f6f9"
  day-surface: "#ffffff"
  day-text: "#101725"
  day-accent: "#2e6be6"
  day-go: "#178a4c"
  day-caution: "#a06a06"
  day-abort: "#cc3b2c"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontWeight: 600-700
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11px"
    textTransform: "uppercase"
    letterSpacing: "0.08em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    purpose: "the measurement register — values, clocks, codes, flags"
  scale:
    flag: "10px"
    leader-note: "10.5px"
    strip-label: "11px"
    mono-value: "12px"
    tool-row: "12.5px"
    body-sm: "13px"
    body: "14px"
    page-title-min: "22px"
    page-title: "30px"
    tile-value: "34px"
rounded:
  led: "2px"
  chip: "4px"
  stamp: "5px"
  control: "6px"
  tab: "8px"
  switch: "8px"
  panel: "10px"
---

# Design System: MCP Workstation — Meridian

## Star: "The Status Wall"

The dashboard is a precision-instrument console, not a card grid. A master
strip carries the uplink LED, the GO/CARD tally and a UTC clock; telemetry tiles
show values in mono with LED ladders that measure real load; the module list is a
**systems status wall** where every row ends in a state chip and hover pins a
leader-note annotation to the row. Trust comes from state legibility: every
tinted pixel answers a real system state or it does not exist.

## The Color Law (binding)

The canvas is cool neutral slate — blue-black at night, white paper by day.
Never warm gray, never sepia: warmth on low-luminance fields reads as dirt.
One accent does all interactive work; three semantics answer only real states:

- **ACCENT azure** `#4f8cff` night / `#2e6be6` day — the primary action, focus, links, active indicators, selection. The only "brand" color.
- **GO emerald** `#3ecf8e` / `#178a4c` — enabled, connected, live.
- **CAUTION amber** `#f0b429` / `#a06a06` — needs setup or attention. Never decorative.
- **ABORT red** `#f26451` / `#cc3b2c` — errors and destructive actions.

Text is a cool white register (`#e9edf3` → `#98a2b3` → `#5b6472`) on night,
slate ink (`#101725` → `#55606e` → `#98a2b0`) on day. Disabled rows take a
neutral hazard-stripe ground, not dimmed opacity theater.

## Surfaces

Two registers of one law, switched by the DAY/NIGHT control in the mission
strip (persisted in `localStorage.mcw-theme`, latched pre-paint, Astryx `Theme`
mode follows the same state):
- **Night** — body `#0b0d12` → surface `#10141b` → card `#141923` → popover `#1a2130`; azure primary action with white ink.
- **Day** — body `#f4f6f9` → surface/card/popover `#ffffff` → muted `#eef1f5`; azure primary action with white ink.
Seams are slate hairlines (`rgba(148,163,184,.13)` / `rgba(16,24,40,.10)`).
Radius scale: LED segments 2px · chips 4px · stamps 5px · controls 6px ·
tabs/switches 8px · panels 10px. Soft hardware, never razor corners, never
pills. Fonts: **Archivo** (labels, titles) and **JetBrains Mono** (every
number, clock, code, state chip); Google Fonts CDN with system fallbacks.

**Instrument type ramp (documented steps):** 10px state-chip caps ·
10.5px leader-notes · 11px strip labels · 12px mono values · 12.5px tool
rows/endpoint code · 13px body-sm · larger reads (tile values, page titles)
set in views with Tailwind steps. Uppercase tracking is restrained: 0.06–0.12em.

## Components

- **Mission rail (`.fd-rail`)** — hand-built navigation replacing Astryx AppShell/SideNav: bolt-plate wordmark + `FLIGHT OPS · V0.1` caption, mono section headings with hairline rules, nav items with a 2px azure detent bar when active, and an UPLINK block (LED + endpoint + open button) over the account plate. On ≤900px it becomes an off-canvas drawer behind a hamburger with scrim.
- **Flight strip** — the dashboard's first band: the live endpoint with uplink LED, copy, and the azure CONNECT A CLIENT button.
- **Controls (`.btn`, `.fd-switch`, `.tab-plate`)** — uppercase 6px buttons in four variants (azure primary, surface plate, azure link, abort danger); detent switches (8px track, 4px knob, emerald when on); tab plates with a top azure bar on the active one. Astryx Button/Switch/TabList/Card are not used in-app.
- **Panels (`.panel`)** — the world's container (10px, hairline seam, card field); `.panel-success` / `.panel-danger` tint the seam with state color.
- **Cold-instrument empty state (`.cold-instrument`)** — dashed hairline frame, `NO SIGNAL` chip, title, copy. Loading uses layout-shaped `.skeleton` sweeps.
- **State chips (`.flag`)** — mono uppercase, 5px, tinted ground + border: `GO / CARD / NO-GO / OFF / LIVE / ACTIVE`; replaces pill badges.
- **Telemetry tiles** — label, 34px mono value, 12-segment LED ladder (`--led-color` per state); power-on sweep is the one authored motion.
- **Leader-notes** — hover/focus annotations pinned by a hairline to their row.
- **Uplink LED** — breathing emerald dot = endpoint linked; static red = down.
- **Pre-flight steps** — 6px number plates that stamp emerald when done, with an `n / 3 COMPLETE` chip on the panel.
- **DAY/NIGHT control** — strip selector switching the register.
- Astryx remains substrate only for overlays and composites (DropdownMenu, Dialog,
  Tooltip, Toast, TextInput/TextArea, CodeBlock, Avatar, MetadataList),
  re-tuned through `--color-*` token overrides.

## Motion

One exponential-out ease `--ease-expo` (cubic-bezier .16/1/.3/1) for anything
interactive; every control takes a tactile press (`scale .985`); panel cards
lift 1px on hover. One authored moment: the instrument power-on sweep (420ms,
staggered 70ms per tile); the status wall cascades its rows once (260ms). The
uplink LED breathes. Hover reveals leader-notes. Loading paints layout-shaped
skeletons (transform-only shimmer). `prefers-reduced-motion` collapses all of it.

## Named Rules

**The Cool-Canvas Rule.** Neutrals are blue-slate at both luminances; warm cast is banned.
**The One-Accent Rule.** Azure is the only decorative-capable color, and only on interactive things.
**The Measurement Register.** Numbers, clocks, codes and chips are mono; prose is Archivo. Never the reverse.
**The Stamp Rule.** Terminal states are stamped (LIVE / ACTIVE / OFF), not hidden.
**The Clean-Canvas Rule.** Body paints `--color-background-body` at document level.

## Lineage

Direction: "Meridian" — precision-instrument consoles on cool neutrals
(Linear/Vercel-grade dark + clean light), replacing "Flight Dynamics" per owner
verdict 2026-09-26: the warm ivory/amber cockpit palette read as dirty and the
razor corners as crude. Structure survived the replacement (rail, status wall,
flight strip, state chips); the palette and geometry world did not. Raises
absorbed: detent toggles + LED ladders (Tape Deck), literal naming + hazard
stripes (Quote Grammar), stamped terminal states (Ticket Wallet), leader-line
annotation (Tensegrity), test-strip previews (Darkroom — pending).
