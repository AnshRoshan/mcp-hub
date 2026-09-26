---
name: MCP Workstation
description: The Flight Dynamics world — a mission-control status wall where every system reads GO / CAUTION / NO-GO at a glance, and color only ever answers a real state.
colors:
  body: "#0d1014"
  surface: "#14181d"
  card: "#10141a"
  popover: "#1a1f26"
  muted: "#191e25"
  text: "#e6e2d6"
  text-secondary: "#a5a294"
  text-disabled: "#5b6068"
  accent: "#ded9cb"
  on-accent: "#12161b"
  border: "rgba(230, 226, 214, 0.11)"
  border-emphasized: "#3a424c"
  go: "#8fdc9a"
  caution: "#e8b34b"
  abort: "#e0705f"
  telemetry: "#6fc3d6"
  day-paper-body: "#eceadf"
  day-go: "#1c7d40"
  day-caution: "#8a5c05"
  day-abort: "#b5402e"
  day-telemetry: "#0d687c"
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
    letterSpacing: "0.12em"
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
  led: "1px"
  stamp: "3px"
  plate: "4px"
  panel: "6px"
---

# Design System: MCP Workstation — Flight Dynamics

## Star: "The Status Wall"

The dashboard is a mission-control flight-rules board, not a card grid. A master
strip carries the uplink LED, the GO/CARD tally and a UTC clock; telemetry tiles
show values in mono with LED ladders that measure real load; the module list is a
**systems status wall** where every row ends in a stamped flag and hover pins a
leader-note annotation to the row. Trust comes from state legibility: every light
on the panel answers a real system state or it does not exist.

## The State Law (binding)

Color is never decoration. Exactly four meanings, held across both registers
(night console / daylight cockpit — hues retuned so they read emissive on
black and ink-stamped on ivory):
- **GO green** `#8fdc9a` night / `#1c7d40` day — enabled, connected, live.
- **CAUTION amber** `#e8b34b` night / `#8a5c05` day — needs setup, attention, selection pending.
- **ABORT red** `#e0705f` night / `#b5402e` day — errors and destructive actions.
- **TELEMETRY cyan** `#6fc3d6` night / `#0d687c` day — measurements and transport info (clock, values, http/stdio plates).
Everything else is flight-black graphite or 1D ivory. Selection is amber (the
safelight exception, a working color). Disabled rows take a hazard-stripe ground,
not dimmed opacity theater.

## Surfaces

Two registers of one world, switched by the DAY/NIGHT plate in the mission
strip (persisted in `localStorage.mcw-theme`, latched pre-paint, Astryx `Theme`
mode follows the same state):
- **Night console** — body `#0d1014` → surface `#14181d` → card `#10141a` → popover `#1a1f26`; ivory text, ivory plate primary action.
- **Daylight cockpit** — paper body `#eceadf` → surface `#f4f2e9` → card `#faf9f2` → popover `#fffef8`; ink text, ink plate primary action.
Panels are 6px, plates 4px, stamps 3px, LED segments 1px — square-ish hardware
corners, never pills. Hairline seams separate; shadows are reserved for
overlay depth. Fonts: **Archivo** (instrument grotesk, engraved-caps labels) and
**JetBrains Mono** (every number, flag, clock, code); loaded via Google Fonts CDN
with system fallbacks.

**Instrument type ramp (documented steps):** 10px flag/wall-head caps ·
10.5px leader-notes · 11px mono strip labels/section counts · 12px mono tool
names/values · 12.5px tool rows/endpoint code · 13px body-sm (status wall,
module meta). Larger instrument reads (tile values, page titles) are set in
views with Tailwind steps; radius scale: 1 / 3 / 4 / 6px only.

## Components

- **Mission rail (`.fd-rail`)** — hand-built flight-ops navigation replacing Astryx AppShell/SideNav entirely: bolt-plate wordmark + `FLIGHT OPS · V0.1` caption, mono section headings with hairline rules, nav items with a 2px telemetry detent bar when active, and an UPLINK block (LED + endpoint + open button) over the account plate in the footer. On ≤900px it becomes an off-canvas drawer behind a hamburger plate with scrim.
- **Flight strip** — the dashboard's first band: the live endpoint with uplink LED, copy, and the CONNECT A CLIENT plate. The overview's story starts with the mechanism.
- **Machined controls (`.btn`, `.fd-switch`, `.tab-plate`)** — engraved-caps uppercase buttons in four variants (primary plate, surface plate, telemetry link, abort danger); square detent switches (4px track, 1px knob, GO-green when on); detent tab plates with a top telemetry bar on the active one. Astryx Button/Switch/TabList/Card are not used in-app.
- **Panels (`.panel`)** — the world's own container (6px, hairline seam, card field); `.panel-success` / `.panel-danger` tint the seam with state color.
- **Cold-instrument empty state (`.cold-instrument`)** — dashed hairline frame, `NO SIGNAL` stamp, title, copy. Loading uses layout-shaped `.skeleton` sweeps.
- **Flags (`.flag`)** — mono uppercase stamps: `GO / CAUTION / CARD / NO-GO / OFF / LIVE / ACTIVE`, tinted ground + border; replaces pill badges.
- **Telemetry tiles** — engraved label, 34px mono value, 12-segment LED ladder (`--led-color` per state); power-on sweep is the one authored motion.
- **Leader-notes** — hover/focus annotations pinned by a hairline to their row.
- **Uplink LED** — breathing green dot = endpoint linked; static red = down.
- **Pre-flight steps** — square number plates that stamp GO-green when done, with an `n / 3 COMPLETE` progress stamp on the panel.
- **DAY/NIGHT plate** — machined selector in the mission strip switching the register.
- Astryx remains substrate only for overlays and composites (DropdownMenu, Dialog,
  Tooltip, Toast, TextInput/TextArea, CodeBlock, Avatar, MetadataList),
  re-tuned through `--color-*` token overrides.

## Motion

Grammar: one exponential-out ease `--ease-expo` (cubic-bezier .16/1/.3/1) for anything
interactive; every control takes a tactile press (`scale .985`); panel cards
lift 1px on hover. One authored moment: the instrument power-on sweep (420ms,
staggered 70ms per tile); the status wall cascades its rows once (260ms). The
uplink LED breathes. Hover reveals leader-notes. Loading paints layout-shaped
skeletons (transform-only shimmer, never layout props). Everything else is
Astryx-native; `prefers-reduced-motion` collapses all of it.

## Named Rules

**The Restraint Rule (upgraded).** If a pixel isn't answering a system state, it is ivory or graphite.
**The Measurement Register.** Numbers, clocks, codes and flags are mono; prose is Archivo. Never the reverse.
**The Stamp Rule.** Terminal states are stamped (LIVE / ACTIVE / OFF), not hidden.
**The Clean-Canvas Rule.** Body paints `--color-background-body` at document level.

## Lineage

Direction: "Flight Dynamics" — mission-control flight-ops walls / NASA 1D status
boards. Seed 4cb4fbb9 (impeccable concept roll), code-led build per owner
directive 2026-09-26. Raises absorbed: detent toggles + LED ladders (Tape Deck),
literal naming + hazard stripes (Quote Grammar), stamped terminal states
(Ticket Wallet), palette law (Arcade), leader-line annotation (Tensegrity),
test-strip previews (Darkroom — pending, applies to credential saves).
