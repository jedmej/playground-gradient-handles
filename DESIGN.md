# DESIGN — Gradient Handles (field mesh editor)

Subject: a mesh-gradient *handle study*. Nine colour nodes on a WebGL field; the
page's single job is to let a visitor feel one interaction detail — grabbing a
node vs. grabbing its influence ring — and nothing else. Audience: designers and
hiring teams reading Jed's portfolio. Visual world: Bungie's Marathon site —
spec-sheet / technical-drawing retro-futurism, not cyberpunk.

## Tokens

### Palette (6 named values)

| Token      | Hex       | Role                                                                 |
| ---------- | --------- | -------------------------------------------------------------------- |
| `SIGNAL`   | `#C0FE04` | Acid lime. Rail fill, chips, text on black. Never text on paper.     |
| `FLARE`    | `#F24723` | Red-orange. *Engaged* state only: dragging core, locked arc, errors. |
| `VOID`     | `#000000` | Top bar, footer, buttons, hairlines, stroke halos.                   |
| `HULL`     | `#1C1C1C` | Dark surface (preset chips, pressed button).                         |
| `GRAPHITE` | `#717171` | Muted labels, ruler numerals, dashed rules.                          |
| `PAPER`    | `#E9EAE4` | Page ground. Cool technical-drawing off-white.                       |

### Dark theme

`DARK [◐]` (top bar; key `M`) sets `data-theme="dark"` on `<html>`. The paper/ink roles flip; SIGNAL, FLARE, the
black chrome plates (top bar, footer, chips, status, hex field, node menu, the SIGNAL rail's ink) and the gradient
canvas do not. Roles that flip are separate custom properties; the black plates are `--plate` / `--plate-fg`, which
never change. The black bar and footer stay black on a near-black ground (a hairline separates active plates).

| Token (CSS)   | Light       | Dark        | Dark contrast on `--paper`        |
| ------------- | ----------- | ----------- | --------------------------------- |
| `--paper`     | `#e9eae4`   | `#151613`   | ground                            |
| `--paper-2`   | `#dfe0d9`   | `#1d1e1b`   | n/a (surface)                     |
| `--void`      | `#000`      | `#dcddd6`   | 12:1 (text, borders, hairlines)   |
| `--ink`       | `#0c0c0c`   | `#ecede7`   | 14:1                              |
| `--graphite`  | `#717171`   | `#9b9c95`   | 6.6:1 (labels, ruler numerals)    |
| `--soft`      | `#1c1c1c`   | `#c4c5be`   | 10:1 (lede, key caps)             |
| `--rule`      | `#a4a59e`   | `#4b4c47`   | dashed rules, keylines            |
| `--wash` / `--wash-2` | black 6 % / 8 % | white 7 % / 10 % | hover tints          |
| `--edge`      | black 35 %  | white 40 %  | palette / preset chip keyline (a `#000000` chip still reads) |
| `--plate` / `--plate-fg` | `#000` / `#e9eae4` | same | fixed chrome plates and their text |
| `--signal`, `--flare`, `--hull` | | same | unchanged                          |

Fixed on purpose: node rings, gauges, FX dial and cursors (halo + ink strokes, designed to read on any gradient),
the lime rail. Default is `prefers-color-scheme`; the choice is stored in `localStorage` (`gh.theme.v1`) and applied
by the inline head script before first paint. Switching runs one View Transition (`document.startViewTransition`): the whole page
crossfades as a single ~300 ms snapshot (`--ease`), while `html.theme-switching` suppresses every per-element
transition. Without the API, or under reduced motion, the theme snaps instantly. Rulers are SVG using `currentColor`, so they follow the tokens.

Gradient presets additionally use a few justified saturated accents inside the
specimen only (coolant cyan `#1FD7E3`, UV violet `#5A2BFF`, hazard yellow
`#FFD400`); they never leak into the chrome.

### Type

| Role    | Face                                             | Use                                                                   |
| ------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Display | **Big Shoulders Display** 900 (variable)         | Only the rotated rail wordmark and the panel title. Tall, squared.    |
| Sans    | **Inter Tight** 500 / 600                        | Sentence-case UI copy: button labels, one-line descriptions.          |
| Mono    | **Martian Mono** variable, `wdth` 87.5 %, 11–13px | Every label, serial, readout, ruler numeral. Uppercase, tracking .06em |

Headings 85–95 % line-height. Mono labels 11–13px with `.04–.1em` tracking. Only
labels/serials are uppercase; actions stay sentence case ("Export PNG" →
"Exported").

### Motion

`cubic-bezier(.4,0,.2,1)`, 140–200ms for UI state; ring reveal 180ms; preset
cross-fade 600ms in OKLab. Pointer following uses an exponential approach with
`k≈28/s` (settles in ~100ms, no perceptible lag). Arc angle glides with the same
curve, shortest path. `prefers-reduced-motion`: snapping instead of smoothing,
transitions 0ms.

## Layout

Desktop (≥ 960px): black top bar → paper body split into stage + spec column →
lime rail on the right → black footer strip.

```
┌──────────────────────────────────────────────────────────────┬──────┐
│ ◇ NEWFRAME   GRADIENT HANDLES [>]        STATE  IDLE [—]     │EXPORT│  44px black
├──────────────────────────────────┬───────────────────────────┤[↓]   │
│ +   0   .25   .5   .75    1   +  │ FIELD MESH 03 × 03        │ ──── │
│ 0 ┌────────────────────────────┐ │ Field mesh editor         │  +   │
│   │  ⌜⌝        ⌜⌝        ⌜⌝   │ │ one line of plain copy    │ ▌▌▌▌ │
│.25│  ⌞⌟        ⌞⌟        ⌞⌟   │ │ ───────────────────────── │  ×   │
│   │        ╭ ─ ─ ╮             │ │ COLOUR SET                │  ⊡   │
│.5 │  ⌜⌝   ⌜ N-05 ⌝  ⌜⌝ ⌜⌝    │ │ ■■■■ CS-01 NIGHT MARSH    │ G    │
│   │  ⌞⌟   ╰ ─ ─ ╯ ⟋ R 184PX  │ │ ■■■■ CS-02 FLARE DRILL    │ R    │
│.75│                            │ │ ■■■■ CS-03 …              │ A    │
│   │  ⌜⌝        ⌜⌝        ⌜⌝   │ │ ───────────────────────── │ D    │
│ 1 │  ⌞⌟        ⌞⌟        ⌞⌟   │ │ NODE  N-05                │ I    │
│   └────────────────────────────┘ │ X .512  Y .430  R 184PX   │ E    │
│ +   N-05 // X 0.512 Y 0.430   +  │ ■ #C0FE04                 │ N    │
│                                  │ [ Export PNG ]  Reset     │ T    │
├──────────────────────────────────┴───────────────────────────┤ 05 01│
│ HANDLE MECHANIC AFTER @EYEXAYUH        NEWFRAME · INTERACTION/STUDY  │  36px black
└──────────────────────────────────────────────────────────────┴──────┘
```

Mobile (< 960px): everything stacks; the rail becomes a horizontal lime band.

```
┌──────────────────────────────┐
│ ◇ NEWFRAME      STATE IDLE   │ black
├──────────────────────────────┤
│ + GRADIENT HANDLES ▌▌▌ × 05 01│ lime band, wordmark horizontal
├──────────────────────────────┤
│  0   .25   .5   .75   1      │
│ ┌──────────────────────────┐ │
│ │ ⌜⌝    ⌜⌝    ⌜⌝          │ │  square-ish stage, full width
│ │ ⌜⌝    ⌜⌝    ⌜⌝          │ │  touch-action: none
│ │ ⌜⌝    ⌜⌝    ⌜⌝          │ │
│ └──────────────────────────┘ │
│ N-05 // X 0.512 Y 0.430      │
├──────────────────────────────┤
│ COLOUR SET                   │
│ ■■■■ CS-01 NIGHT MARSH   44px│  tall rows, thumb-sized
│ ■■■■ CS-02 …                 │
│ NODE N-05  X .512 Y .430 …   │
│ [ Export PNG            ]    │  48px, black, lime text
├──────────────────────────────┤
│ credits                      │ black
└──────────────────────────────┘
```

## Signature element

**The bezel.** A node's influence ring is not a soft dashed circle; it is a
graduated instrument bezel — a dashed ring with tick marks every 15° (longer at
the cardinals). When the pointer enters the ±10px band the system cursor
vanishes and a 40° lime *bearing arc* slides around just outside the bezel,
carrying the `R 184PX` readout at its angle. Dragging locks the arc in FLARE
red-orange and the bezel goes solid. The reticles themselves stay small and
quiet (corner brackets + a dot core) so the bezel moment is the one thing you
remember.

Everything else — rulers, registration marks, grid crosses, barcode stack — is
reduced to hairline weight and encodes real data (stage coordinates, node
serials, preset serials, live state).

## Critique before build

**1. "Near-black + one acid accent" dark UI.** My first draft was exactly that:
black everywhere, lime accents, which is both the Marathon screenshot and the
generic AI default. Jed explicitly allowed *off-white or black*. Revision: the
page ground is PAPER (`#E9EAE4`), a technical-drawing sheet; black is confined to
the top bar, footer, buttons and hairlines, and lime to the rail and chips (never
lime text on paper — contrast fails and it looks cheap). The gradient specimen
then reads as a mounted plate, and the dark presets get real contrast against
the sheet. This keeps the Marathon grammar (black bar + lime rail + black-on-lime
blocks) while avoiding the dark-dashboard template.

**2. Generic cyberpunk.** No glow, no RGB-split, no scanlines, no violet/pink
synthwave pair. The only glow-like thing is film grain in the shader, which is
photographic (Marathon's hero is grainy video), not neon. UV violet is used in
one preset, paired with black and paper, not with pink.

**3. Broadsheet / hairline default.** Hard edges and 1px rules are pinned by the
brief, so they stay, but they must *mean* something: the rulers are the actual
0–1 coordinate system of the readouts; the rail numbers are the live selected
node and preset serial (`05 01`); the barcode stack is the nine node radii as
bar heights, so it changes as you drag. Decorative numbering (01/02/03 section
markers) was cut.

**4. Reticles vs. Isaiah's dots.** First sketch had full crosshair lines through
the core, which fought the gradient. Revised to four short corner brackets + a
3px dot core, dual-stroked (1px light over a 3px 60 % black halo) so they read
on both lime and black regions of the field.

**5. State colour.** Draft used lime for every active state. Revised: lime =
*affordance* (hover, available), FLARE = *engaged* (dragging core, locked arc,
focused + nudging). Two colours, two meanings; matches Marathon's primary/error
split.

Build to this revised plan.

## Round 2 (art-direction pass)

- **Field:** a 3-octave value-noise domain warp (≈ ±6 % of the short side, slow
  drift, static under reduced motion) bends the sample position before the
  gaussian weights, and the weight tail was softened, so seams curve instead of
  forming a plaid of axis-aligned crosses. The export uses the same warp.
- **Presets:** every colour set has a composed first frame — nodes sit off the
  perfect grid with varied radii. CS-01 Night Marsh keeps its dark swamp with
  lime light breaking through from two corners, no dead black column.
- **Bezel:** dual-stroke ring (lime/ink over a dark halo) that brightens on
  ring-band hover and goes solid on drag; ticks every 15° (cardinals 9 px,
  others 4 px); mono bearings 000 / 090 / 180 / 270 appear only while the ring
  is hovered or dragged, and hide instead of clipping at the stage edge.
- **Rulers:** end labels are inset so they clear the corner registration marks
  on narrow screens.

## Round 3 — Rozwiń (dynamic nodes + custom palette)

- **Node count 2–16.** `MAX_NODES`/`MIN_NODES` live in `store.ts`; the shader takes
  `u_count` and breaks out of a fixed 16-iteration loop (WebGL1-legal). Nodes carry a
  stable `uid`; `Handles.syncViews()` keys the SVG views by it, so re-indexing never
  moves a reticle's animation state and DOM order always equals array order (Tab order).
  Listeners resolve the index at event time.
- **Add.** Double-click / double-tap on empty field (detected manually from pointer
  events, 320 ms / 24 px, so touch behaves like mouse). The `Add node` button picks the
  farthest point of a 9×9 grid. The new node takes the CPU-evaluated field colour under
  it, radius 0.28, is selected, and "acquires": brackets start at 22 and settle to 14
  while the ring eases in (snaps under reduced motion). At 16: `NODE LIMIT 16`.
- **Remove.** Delete/Backspace, `[−] Remove node`, or (touch, since round 4b) tap → hold → `DELETE` in the node
  menu. The 550 ms hold on a selected core now opens that menu; its feedback is a SIGNAL arc, not FLARE (brackets
  close in from 14 toward 6 while the arc fills around the core, so it reads differently from a plain drag). Moving > 6 px cancels it and it stays a normal drag. At 2 nodes:
  `MIN 2 NODES`. Selected/focused/armed indices are remapped on removal; hover and drag
  are cleared.
- **Colour.** The panel edits `selected ?? focused`, never hover. `[■]` swatch (native
  colour input, visually hidden, label-wrapped) plus a mono HEX field on a void plate:
  lime underline on focus, FLARE when invalid, Enter/blur commit, Esc reverts. Tween is
  per node (240 ms OKLab). The shared-array tween bug is fixed: `lab`/`labFrom`/`labTo`
  are distinct arrays and a tween copies `lab` into `labFrom`.
- **Palette strip** under the NODE label: one chip per node, live, click selects; the
  selected chip gets a lime underline.
- **CS-06 CUSTOM.** `SAVE [↧]` writes `gh.custom.v1` (`{v:1,nodes,savedAt}`); parsing is
  defensive. Restoring reconciles count (survivors glide, extras acquire, surplus drops).
  Reset on CS-06 restores the saved state. Edited presets show a dim `MOD` tag.
- **Undo.** `history.ts`: snapshot stack (cap 50) of `{presetIndex, nodes}`. Gestures
  snapshot at start and push on end only if something changed; colour edits are one step
  per session; arrow / radius-key nudges coalesce per 700 ms burst. ⌘/Ctrl+Z, ⇧⌘Z / ⌘Y redo,
  ignored inside text inputs. `UNDO [↶]` button beside Reset.

## Round 3b — fixes

- **Spec column.** The actions block was `position: sticky` and painted over the NODE
  section; it is now an ordinary flex child. On desktop, Add/Remove are one row and
  Export/Undo/Reset one row (36–38 px; 40 px on coarse pointers), labels are `nowrap`.
  `@media (max-height: 920px / 820px)` tighten padding, gaps, preset rows (28/26 px) and
  title (44/36 px) and hide the lede; the key legend stays (tighter) and only hides
  below 760 px tall. Verified by bounding boxes: no
  sibling intersections and no scroll at 1280×800, 1440×900, 1366×700 and 1920×1080.
- **Status** is Martian Mono 11 px, SIGNAL on a VOID plate, full opacity while shown;
  the line's height is always reserved (no layout jump). Still the `#status` live region.
- **Touch gestures.** Double-tap 380 ms / 36 px (mouse stays 320 ms / 24 px). Long-press
  removal arms only if the node was already selected before the press (tap selects,
  then press-and-hold removes); the FLARE arc shows only on that armed hold; movement
  > 6 px cancels. At 2 nodes the hold just reports `MIN 2 NODES` and the drag continues.
  Hint copy: `TAP + HOLD` (round 4b: → menu).
- **Undo by identity.** Snapshots carry each node's `uid`; restore matches by uid, so
  survivors keep their views and positions, a removed node returns at its original
  array index with its original uid/x/y/r/hex, and add/redo behave the same. Selection
  refs are remapped by uid. Preset specs (no uid) still reconcile by index.

## Round 3c (v2.1)

- **Black swatch.** The `[■]` swatch chip carries a GRAPHITE keyline with a 1 px VOID gap
  (`outline-offset: 1px`), like a mounted specimen, so `#000000` and near-blacks read as a
  filled chip on the black plate instead of an empty bracket.
- **Touch copy.** The intro says "Double-click" on fine pointers and "Double-tap" on
  `(pointer: coarse)`, the same switch the shortcut legend uses.
- **CLEAR CS-06.** `CLEAR [×]` sits left of `SAVE` and only exists while a custom set is
  saved. It is a quiet GRAPHITE ghost; the first press arms it (FLARE plate, `CLEAR?`,
  status "Press CLEAR again to delete CS-06"), a second press within 3 s removes
  `gh.custom.v1` and returns the row to `CUSTOM — EMPTY`. Esc, blur or the timeout disarm
  it. The field is left untouched; if CS-06 was active it becomes CS-01 + `MOD`, and undo
  never re-activates an empty CS-06.

## Round 4 — shapes + draw

**Field math.** The weight is unchanged, `w = exp(-1.5 q²) + 0.05 / (1 + q⁴)`; only `q` is
per shape, in canvas px on the warped point, with `l = rotate(p − c, −rot)` and `r` the reach:
circle `|l|/r`; ellipse `|(l.x, l.y/0.45)|/r`; box `(|l.x|⁶+|l.y|⁶)^(1/6)/r` (a rounded
square); capsule `|(max(|l.x|−0.6r,0), l.y)|/(0.35r)`; stroke `d/r` with `d` the distance to
the polyline. `field.ts#nodeQ` is the CPU mirror (no warp) used for the colour of new nodes
and for hit testing. `packField` fills every shader input for a target size and serves both
the live tick and the 2048 px export (export reads settled targets, live reads the smoothed
display values), so shapes and strokes appear in PNGs.

**Stroke data texture.** 64 × 16 RGBA8, NEAREST, clamp, no mips, so no float-texture
extension is needed. Row `i` is node `i`; each texel is an absolute canvas position over
`[−0.5, 1.5] ×` the canvas CSS size as 16-bit fixed point (x in R/G, y in B/A). The renderer
re-uploads with `texSubImage2D` only when the bytes differ. Points that leave that range
(a big stroke dragged to an edge) clamp. The shader's stroke loop is bounded by `u_npts`.

**Hit priority.** Core > ring band (revealed rings only) > body > empty field; nearest wins
inside a class. Body = polyline distance ≤ max(16 px, 24 px coarse, 0.45 r) for strokes,
`q ≤ 0.45` for ellipse / box / capsule; circles have none. A body drag is the ordinary node
move drag (grab offset kept, one `MOVE` undo step). The ring stays a circle of radius `r`
for every shape; a stroke's reticle sits at its centroid. Stroke nodes show their path as a
dashed dual stroke (SIGNAL while the body is hovered or dragged); ellipse / box / capsule draw
no outline (removed in v6.1: the field already shows the shape and it cluttered the gauges).

**Draw flow.** `D` / `DRAW` enters the tool (colour = the selected node's, else PAPER). Press
creates the stroke node at once so the field reacts live; points are sampled at ≥ 2 px, the
live preview is capped at 64 points by RDP, and a thin guide (`#draw-guide`) follows the
pointer. Release simplifies, recentres (centroid → x/y, offsets → pts), selects, commits one
`DRAW N-xx` undo step and leaves the tool. Under 12 px of path, or on `pointercancel`, the
provisional node is removed with no undo step and the tool stays on.

**Decisions.** Strokes cannot be converted to shapes and back (picker disabled, tag shows the
point count). Shape and rotation sit on one row as square glyph buttons, with no 3-letter
labels, because labels do not fit the 296 px column; on touch the row wraps to two lines at
40 px. CS-06 round-trips shapes (`v:2`); the built-in presets have none, so applying one
returns every node to a circle. Default stroke reach is 0.16.

## Round 4b — reach by scroll, softness, layers

**Softness.** Every node has `soft` ∈ [0, 1] (default 0.5; strokes 0.75 for a wide haze). With `q` the shape's
normalised distance (unchanged), the weight is `w = exp(−1.5·max(q, 1e-4)^p) + tail / (1 + q⁴)` where
`p = soft < .5 ? mix(8, 2, 2·soft) : mix(2, 1.15, 2·soft − 1)` and
`tail = soft < .5 ? mix(.004, .05, 2·soft) : mix(.05, .14, 2·soft − 1)`. At 0.5 that is exactly the old
`exp(−1.5q²) + .05/(1+q⁴)`; at 0 it is a near-flat plateau with a crisp edge, at 1 a very wide haze. The shader
reads `u_soft[16]`, filled by `packField` (smoothed `dsoft` live, settled `soft` for export), and `color.ts`
(`softP`, `softTail`, `coreWeight`, `sampleField`) is the CPU mirror.

**Layers.** Layer order is `store.nodes` order (0 = back). The shader first computes the normalised weighted OKLab
average (`base`, tails included), then in array order `col = mix(col, lab_i, 0.85·exp(−1.5·q_i^p_i))`: the core term
only, no tail, so a higher node dominates where they overlap, edges stay soft and empty areas keep the average.
Reordering (`moveNodeTo`) renumbers serials, palette strip, barcode and Tab order like a removal; views stay keyed by
uid and selected / focused / armed are remapped by uid. A re-inserted focused reticle is re-focused so `[`/`]` can repeat.

**SOFT gauge.** Inside the bezel, a 270° arc with the gap centred on 6 o'clock: 0 % at the lower left (screen angle
135°), running clockwise over 9 and 12 to 100 % at the lower right (405° = 45°). Radius `ri = clamp(0.55·r, 22, r − 18)`;
11 ticks (every 10 %, the 0/50/100 ticks longer); a SIGNAL fill arc from the start to the value (FLARE while dragged
or wheeled); a radial knob at the value (white → SIGNAL on hover → FLARE dragging); the `SOFT 62` mono label sits in
the gap while hovered / dragged. Dual-stroke like the bezel. It lives inside the ring group, so it is visible exactly
when the bezel is; it is hidden under `r_px < 64` and in draw mode. Cursor stays the stage crosshair; the knob is the
highlight. (Superseded: gauge hit-testing is now `gaugeHit` in `gauge.ts`, shared with the FX dial: half a ring spacing either side of the ring, at any angle, the bottom gap included, so the bands tile the stack and the cursor stays swallowed across it.)
**ROT dial and OPAC gauge.** Three concentric controls, one radius each, so every label has its own room: ROT on the
outside at `r − 16` (a full 360° track: a dial, because rotation has no end stop), SOFT at `0.55·r`, OPAC at `0.58 ×` SOFT's
radius. ROT: 24 ticks (every 15°; 90° and 45° longer), a SIGNAL fill from 000 to the angle, a radial notch riding round
(white → SIGNAL hover → FLARE drag / wheel), 0 = up and clockwise like the bearings; it sits just inside the ring band
(hit ±6 px) so it never touches the resize grab, the bearings (outside the ring) or the SOFT/OPAC arcs. OPAC is SOFT's twin
(270° arc, gap at 6 o'clock, 11 ticks, fill, knob, `OPAC 80` in the gap). Shapes: ROT only for ellipse / box / capsule
(a circle looks the same turned; strokes ignore `rot`); OPAC for all. Hover thickens the fill and notch; a FLARE chip
(`ROT 045°`, `OPAC 61%`) rides by the notch while hovered, dragged or wheeled. The stage cursor is swallowed on hover and
drag (`cursor: none`) and while wheeling a gauge (`wheel-hide`, ~700 ms); the notch is the cursor. While any gauge or ring is
adjusted the stage gets `ui-focus` and the node `is-focus`; the shared CSS dims the other on-artboard UI.
Opacity (`opac`, default 1, omitted from saves at 100 %) multiplies the node's weight in the soft average and its core mix
in the shader (and in `sampleField`), so a faded node dissolves into its neighbours' colours, never into transparency.
All three gauges hide under `r_px < 64` and in draw mode.
Wheel is hit-tested per zone like `pick()`: SOFT / ROT / OPAC zones drive their value, anywhere else resizes; a burst keeps
the zone it started in.
Priority: **core > ROT dial / OPAC / SOFT gauges > ring band > body > empty**; the gauge (≤ r − 11) and the ring band (≥ r − 10) barely meet.
Dragging maps the pointer angle to 0–1; inside the gap the value sticks to the end it came from, and re-entering the
arc on the far side is ignored until it is within 0.5 of the held value, so it never jumps across the gap.

**Wheel.** A non-passive `wheel` listener on the stage. Targets: whatever `pick` hits (core, gauge, ring band, body), else
the hovered / armed node while the pointer is within `r + 1.6·band` of it. Otherwise nothing happens and the event is not
prevented. Deltas are normalised (`deltaMode` 1 → ×16, 2 → ×400). Plain: `r *= exp(−dy·0.0015)` clamped to
[R_MIN, R_MAX]; `ctrlKey` (trackpad pinch) ×3 and always prevented; `shift` / `alt`: `soft −= (deltaY || deltaX)·0.0012`
(Shift+wheel is deltaX in Chromium on macOS). A FLARE chip (`R 184PX` / `SOFT 62%`) and the bezel stay for 0.9 s; bursts
coalesce into one undo step per 700 ms gap. Not in draw mode, not mid-drag. Touch pinch: two touches while a node is
selected scale its reach by the distance ratio from the pinch start (one `RADIUS` step); a second finger cancels any
one-finger drag, hold or stroke. Fingers rarely both land on the core: if the first finger touched empty field and so
deselected the node, a second finger within 400 ms restores that selection and pinches it.

**Node menu.** `contextmenu` on the stage is always prevented. A hit node is selected and a VOID plate (1 px GRAPHITE
keyline, mono caps, key hints right-aligned, header `N-05 · LYR 03/07`) opens at the pointer, kept inside the stage:
BRING TO FRONT `⇧]`, MOVE UP `]`, MOVE DOWN `[`, SEND TO BACK `⇧[`, DELETE `DEL` (FLARE on hover / focus). Hover / focus
= SIGNAL on HULL; focus highlight only shows after the first arrow key, so a mouse-opened menu has no stray row.
Disabled items dim. Touch: the 550 ms hold on an already-selected core opens it beside the node (rows 44 px); a hold on an
unselected node does nothing and touch ignores the `contextmenu` event so Android's own long-press cannot open it early.
The plate is `rgba(0,0,0,.995)`, not `#000`: a fully opaque plate over the WebGL canvas made Chrome cull a wrong canvas
rectangle.

**Keys.** Radius moved to `-` / `=` (`+`, numpad) with Shift = 16 px; `[` `]` are layers, matched on `e.code` so Shift and
non-US layouts behave.

**Decisions.** Softness is not part of the preset data (built-ins reset it); CS-06 stores it only when it differs from the
shape default. SOFT shares the panel's R row (readout, 10-segment bar, `[−]` `[+]`), which costs no height; at 1280×800 the
legend was also trimmed (SCROLL and `− =` share one radius chip) so nothing scrolls. `data-soft` reports the target value, `data-radius` the
displayed one.

## v4 — FX + wallpaper

**Pass order** (one post shader, fixed, no UI for it): chromatic aberration → vignette → scanlines → grain → dither. Dither is last so it quantises the colour the viewer actually sees; aberration is first because it needs to resample the clean field.

**Formulas.** With `d = (uv − 0.5)·res / min(res)` (short side = 1) and `dc` = `d` at a corner:
- Aberration: `o = d · (chroma/100) · 0.07 · |d|²/|dc|²`; R at +o, G at 0, B at −o, three taps per fringe channel (0.33·o, 0.66·o and o) so the edge is a spectral smear rather than a double image.
- Vignette, in linear light so hue survives: `rgb *= 1 − (vig/100)·0.82·smoothstep(0.28, 1.08, |d|/|dc|)`; 100 is deep, not black.
- Scanlines: period 3 px, `s = ½ − ½cos(2π·fract(y/period))`, `rgb *= 1 − (scan/100)·0.5·s²` (thin crisp lines). Direction `H | V | B` (`scanDir`, default H): V runs the same profile on `x`; B takes `max(s_h, s_v)` so the grid never darkens more than a single set of lines at the same knob value.
- Grain: monochrome, `(n − ½)·(grain/100)·0.20·(0.35 + 2.6·L(1−L))`, heaviest in the mids. Fine = one hash per 1 px cell; coarse = two-octave value noise on 2.5 px cells (35mm).
- Dither, per channel in sRGB: `q = floor(c·(N−1) + t)/(N−1)`, N = 2–16.

**Why seeded grain.** The base grain in the field shader animates; the FX grain has no time term, so a PNG is the same picture you were looking at and a screenshot is reproducible. Low values double as debanding.

**Why per-channel sRGB dither.** Each channel keeps its own steps, so the image keeps its palette (no foreign palette remap); the thresholds only decide which neighbouring step a pixel takes, so the local average is preserved. Bayer 8×8 (2 px cells) is the visible retro pattern; blue noise (64×64 void-and-cluster, σ 1.5, seeded, ~60 ms once at startup, shared by the export context) is the quiet one.

**Unit scaling.** Cell sizes are authored in preview CSS px and become `max(1, round(base · fxUnit))` buffer px. Preview `fxUnit` is the DPR scale; export `fxUnit = u / stage.min`. Aberration and vignette are resolution-independent already.

**Reframe rule (wallpaper).** Cover-fit, keep node positions relative: the field fills the target, centres stay at `(x·W, y·H)`, and all size-like values use `u = stage.min · √(W·H / (stage.w·stage.h))`. For a same-aspect target `u = min(W, H)`, i.e. the old export, exactly. Nothing is letterboxed or cropped, so no node can fall off the image; the price is that a very different aspect stretches the layout rather than cropping it.

**Artboard = target (WYSIWYG).** The stage itself takes the selected target's aspect: contain-fitted inside the stage column, centred, never overflowing (`fitStage` in `main.ts`; on the stacked mobile layout the width bounds it and the height is capped at ~68 % of the viewport). Rulers, foot strip, canvas, handles and readouts all follow the stage's measured box, so the corner readout shows the real preview size. Node `x/y` stay normalised to the stage and radii / stroke offsets to its short side, so switching targets never rewrites the composition and switching back restores it exactly. With the stage already at the target aspect the reframe above reduces to a uniform scale (`u = min(W, H)`): the PNG is the artboard, resized. The change is a snap, no animation (the canvas resolution changes with it).

**Knob.** The SOFT gauge's language in a 30 px SVG: 270° sweep with the gap at 6 o'clock, 21 ticks (every 5 %), INK when lit, FLARE while engaged (drag, or the 900 ms after a wheel / key step). The hit area grows to ≥ 44 px on coarse pointers via a pseudo-element, so rows keep their rhythm. Dither runs OFF, 16 … 2 levels (16 positions): turning up always means a stronger effect.

**Custom wallpaper size.** Sixth target `CUSTOM` (dashed glyph at the live aspect). Selecting it reveals a mono row `W [ ] × H [ ] ⇄ 16–16384 PX`: hairline-underlined numeric inputs, digits only while typing, clamped to 16..16384 on Enter/blur (Esc reverts, invalid text is struck through and the range hint underlines). The size lives in `store.wpCustom`, persists as `cs` beside `wp`, and is not an undo step.

**FX dial.** A global overlay (`fxdial.ts`) that puts the effects on the artboard as a sibling of the node ring, built from the same parts: a dashed bezel with 24 ticks and 000/090/180/270 bearings (`ticksPath`, `bracketPath` shared from `handles.ts`), corner brackets plus a core dot at the click point, and inside it one 270° gauge per enabled effect (the SOFT gauge's geometry): INK over a black HALO, 11 ticks, SIGNAL fill and notch. Rings are concentric in fixed `FX_IDS` order, innermost first. Each ring's label is a black mono chip (the node coordinate tag, `GRAIN // 50`) sitting in that ring's own open bottom gap; hovered it turns SIGNAL, dragged FLARE. Hover is a radial-band test: the ring thickens (fill 2 → 3 px), the others drop to 70 %. No backdrop darkening: legibility comes from halo + ink alone. While a ring is dragged (pointer captured, so it survives leaving the band or stage) or wheeled, the system cursor is hidden like the node ring's and the enlarged notch riding the arc is the cursor; it returns on release, Esc, cancel, the next real pointer move or 700 ms after the last wheel tick. Spacing derives from the stage's short side so five rings plus bezel fit even the phone artboard. It acquires like a fresh node: bezel settles, brackets close in from 2×, rings grow out from the centre in turn (≈ 260 ms, off for reduced motion). A click on empty board opens it at the cursor only when nothing is active (checked at press time, before the deselect: with a node selected, the first click just deselects) and the next click off the rings closes it (the click still passes through, so deselect and node grabs work; no re-open from the closing click) (`pick()` = none, no drag, not DRAW), delayed 240 ms so a double-click (add node) cancels it; `F`, the `FX DIAL [F]` foot button (cursor if over the stage) and ⌥+scroll remain. While open it owns pointer, wheel and keys in the capture phase, so nodes neither hover nor resize. Only effects that are on have a ring: one taken to 0 stays while it is still in hand (dragged, wheeled, keyboard-focused) and goes on release, so nothing vanishes under the pointer. Empty state: the bezel alone with the chip `FX // ALL OFF · CHECK AN EFFECT`.

**Open / close sequence (node bezel and FX dial).** One linear progress per bezel (open 260 ms, close 200 ms, instant under reduced motion) feeds a staggered, ease-out-cubic share to each part: ring and ticks, bearings, ROT, SOFT, OPAC, labels (FX dial: bezel, then rings innermost first); each part runs over half the span, starting 10 % later than the one before. Brackets close in from 2× on open; on close the sequence is simply the progress run backwards (outer parts collapse first, the ring fades last) and the brackets swing out and back. Because it is one state variable, reversing mid-way, or two nodes opening and closing at once, turns round smoothly with no flicker. Hit-testing follows the logical state (`revealed()` / `open`), not the progress, so a closing bezel is not grabbable; the FX dial only hides after it has finished collapsing.

**Adjust focus.** While a control is dragged or wheeled (until 700 ms after the last tick) only that control stays at full strength: everything else on the artboard, including the node's own ring, other gauges, brackets, coordinate tag, other nodes, grid and the FX dial's bezel, reticle and other rings, drops to 20 % (`filter: opacity(.2)`, ≈ 100 ms in, ≈ 200 ms out; none under reduced motion). The 70 % hover dim of FX rings applies only when merely hovering.

**Node gauges = FX rings.** OPAC, SOFT and ROT are no longer tied to the node's size: they are the FX dial's gauge (`gauge.ts` is the one renderer for both: 270° arc with the gap at 6 o'clock, halo + ink base, 11 ticks, SIGNAL fill, notch, a black mono chip in the bottom gap, the same hover thickening, FLARE and dimming) on fixed radii packed round the core with exactly the dial's spacing rule (`gaugeSpacing` in `gauge.ts`: `sp` = 30 px on a big stage, shrinking on small ones, ring `i` at `1.5·sp + i·sp`, i.e. OPAC 45, SOFT 75, ROT 105 on the usual stage, innermost first; ROT is outermost, as before, and only for non-circle shapes). Chips read `OPAC // 80`, `SOFT // 50`, `ROT // 045°` and replace the old floating value chips (only `R 184PX` remains, for the size ring). ROT maps 0–360° onto the 270° arc and wraps at the end (`⇧` snaps to 15°; a wheel tick still turns it ~4°). The size ring and its ticks and bearings still scale with the node, but only circles show them: ellipse, box, capsule and stroke already draw their own dashed outline, so the dotted circular ring (with its ticks and bearings and its drag band) is hidden for them (`no-ring`) and they resize by scroll, pinch or keys; the corner brackets stay. There is no minimum node size any more: on a small node the gauge stack simply extends past the ring. Hit priority: core > ROT > SOFT > OPAC bands (±7 px, ±10 coarse) > ring band > body; the wheel over a band tunes that gauge, anywhere else on the node (the empty space between the stack and the ring included) it resizes. The coordinate tag sits just outside the outermost gauge. Reveal order on open is ring, bearings, OPAC, SOFT, ROT, innermost first like the FX rings.


**Stage column bands (toolbar / artboard / shortcut strip).** The stage column is a three-row grid: `.toolbar` (auto, hairline below), `.stage-area` (1fr, centres the frame) and `.keys` (auto, hairline above). Every global action moved out of the spec panel into the toolbar as `.mini.tb-btn` (28 px, mono, bracket hints; 40 px on touch), grouped with 1 px VOID dividers: NODES (Add, Remove, DRAW) · HISTORY (Undo, Reset) · then, alone at the far right with no divider (`margin-left: auto`), EXPORT (one `Export [↓]` in the VOID/SIGNAL plate: a click renders the wallpaper target size, `⇧`-click or `⇧E` the quick 2048 px copy, `E` = click; the tooltip names the target size); the status plate floats just left of Export (a fixed toast on mobile). FX DIAL and PREVIEW stay small corner buttons above the frame's top-left / top-right (children of `.stage-frame`, so they track every re-fit); the foot strip keeps only `CUR` and dims. `fitStage()` measures `.stage-area` (so toolbar wraps and strip lines are already subtracted), and a ResizeObserver on the area and toolbar re-fits on wrap and panel collapse. The panel keeps only contextual controls (SAVE/CLEAR, steppers, shapes, FX, wallpaper target). The strip lists the keys and gestures (TAB, arrows, scroll, ⇧ scroll, double-click, click core = colour, D, `, .`, DEL, ⌘Z, F, P, `\`, Esc; touch variants under coarse pointers) and wraps to at most two lines on desktop. Mobile (< 960 px): toolbar is one horizontally scrolling row so nothing wraps into a tall block; the strip wraps. Preview hides toolbar, FX DIAL and strip (visibility, no layout shift) and keeps PREVIEW.

**Preview [P].** A corner toggle (the earlier text calls it a foot-style toggle; it is now the `.corner-preview` mini ghost) (`PREVIEW [P]`, the FX DIAL button's mini ghost; active = VOID plate, SIGNAL text, `aria-pressed`) floats above the artboard's top-right corner (own 46 px strip on mobile, touch-sized). `.stage-frame.is-preview` fades rulers, registration marks, foot strip and everything on the stage except the canvas to 0 over 200 ms (`visibility` flips after the fade; none under reduced motion), so only the exported image remains, with the frame's box and aspect unchanged. Input is blocked by window-capture listeners in `main.ts`, registered before every other component: pointer, wheel, click and context events whose target is the stage are stopped, as are all keys except `P` / `Esc` (exit), Tab, Enter/Space on buttons and typing fields. Entering closes the FX dial, leaves DRAW and is refused mid-drag. Never persisted.

## v5 — COLOUR page on the node bezel

**Collapsible spec panel.** `PANEL [»]` / `[«]` (mono bracket button, SIGNAL glyph, in the top bar after the STATE readout so it stays reachable when the panel is gone; key `\`). `html.panel-off` (set before first paint by an inline script, persisted as `gh.panel.v1`) animates the body's spec track to 0 and slides the panel out under the SIGNAL rail over 220 ms in the app easing; the stage column grows, the ResizeObserver re-fits the artboard on the way and `layout()` runs once more on `transitionend`. The collapsed panel is `inert` and `visibility: hidden` after the slide; global shortcuts are unaffected. Under reduced motion it is instant. Below 960 px the panel is part of the page flow, so the toggle is hidden.

**Entering and leaving.** A click on a node's core (press and release inside 4 px, 8 on touch; `coreDown` in `handles.ts`, cleared by any drag movement, a long-press hold or a pinch) flips that node's bezel from the default page (OPAC / SOFT / ROT) to the COLOUR page; the same click again, `Esc` (the first press leaves the page, the second deselects), `Enter`, or anything that deselects the node (a click off, delete, a tool change) goes back. One node at a time (`colorUid`); `busy()` counts it, so an empty-board click only closes the page and never opens the FX dial. The press is still a normal node drag first (one move undo step), so moving the node, touch hold-for-menu, the empty-field double-click add and the right-click menu are untouched; the click only decides at pointer-up.

**Gauges.** The same `gauge.ts` renderer on the same three radii (HUE where ROT sits, SAT where SOFT sits, LUM where OPAC sits: outer to inner HUE, SAT, LUM). `colorpage.ts` paints each track as 90 butt-capped arc segments (3° each, 1.35 overlap) over a black keyline: crisp at any size, no gradient seams, and a conic gradient is not available on SVG strokes. The base hairline and the SIGNAL fill give way to the colour band; ticks, the notch, chip, hover thickening, FLARE on drag, cursor swallow, wheel (`wheelUp`) and `ui-focus` dimming (`focus-hue|sat|lum`) are the shared ones. HUE's track is the full wheel at the current lightness (never below 75 % saturation, so it does not go grey with the colour); SAT's runs from grey to the full-chroma colour at the current L and h; LUM's from black to white through the current hue and saturation. A keylined swatch disc at the core shows the colour.

**Model.** OKLCH, matching how `color.ts` and the shader already work in OKLab: L is lightness, h hue, and SAT is chroma as a share of the most chroma that fits sRGB at that L and h (`maxChroma`, bisection), so every dial position is an in-gamut colour and 100 is always the most vivid one available. Edits write hex (`withAxis` -> `oklchToHex`) with no tween so the field follows the pointer, and the panel swatch / hex update from the same emit. The node keeps only hex; `ColorState` holds the unrounded L / s / h behind it while the page is open and is reused as long as the node's hex is the one it last wrote, so hex quantisation never nudges the knobs and an achromatic colour (SAT 0, or L at an end) keeps the hue you dialled. If the hex changes elsewhere (panel, undo, preset) it is read back from the hex.

**Page flip.** A per-node linear `pg` (0.36 s): the first half collapses the default gauges outermost-first (the open stagger reversed), the second grows LUM, SAT, HUE innermost-first and fades the swatch in, all multiplied into the bezel's own staggered fade. Hit-testing follows the logical page (`onColor`), not the animation.

## v6 — FX (HALFTONE, PIXEL, ASCII, MAP, GLOW, GRADE, WARP)

**Pass order.** Still one post shader, fixed: pixel (resamples the grid every tap reads) → chromatic aberration → glow → grade → map → halftone → ASCII → vignette → scanlines → grain → dither. Pixel is first so aberration and glow see the mosaic; grade and map come before the pattern effects so a halftone or glyph cell is the colour the viewer would have seen; vignette, scan, grain and dither stay last, as before (dither still quantises what is on screen). All cell sizes follow the `fxUnit` rule (authored in preview CSS px, `max(1, round(base · fxUnit))`), so a 4K export matches the preview. Every new effect is a uniform-gated branch: off, it costs nothing and the output is unchanged.

**HALFTONE.** A 45° screen (cell 5 or 9 preview px, FINE / COARSE). One source tap per cell at its centre, graded and mapped; dot radius `0.71·√L`, so the dot area follows luma and L = 1 fills the cell. Dots are the cell colour divided by its luma (clamped), sitting on a sheet at 7 % of the cell colour: print-like, but the palette survives. The amount mixes the screen over the plain image. Screen angle is fixed: the panel row has room for one option group, and cell size matters more than angle for this tool.

**PIXEL.** Block `2 + 38·v` preview px; the field is sampled at each block centre. No option.

**ASCII.** Nine procedural glyphs (blank, `.`, `:`, `-`, `=`, `+`, `*`, `#`, a solid block) built from anti-aliased bars and dots in 1 : 1.7 cells (6 or 10 px), chosen by the cell's luma. No atlas texture and no font: nothing to load, and the glyphs scale cleanly to export sizes. Glyph colour is the cell colour (a touch brighter) on a ground at 7 %. Amount mixes it over the image.

**MAP.** Three modes behind one amount. POST: per-channel posterize, 12 levels at the lowest value down to 2 at 100 (turning up is stronger, like DITHER). DUO / TRI: luma is stretched between the luma of the darkest and lightest node colours, then mapped through darkest → lightest (duo) or darkest → median → lightest (tri, the median-luma node; with two nodes the middle is their mix); the amount blends the map over the image. Colours come from the live nodes (`mapColours` in `post.ts`), so recolouring a node recolours the map and presets map themselves: no extra palette UI. The labels are `PST` / `DUO` / `TRI` to fit the row.

**GLOW.** Bloom in the same pass: 24 golden-angle taps over a radius of `(10 + 30·v)` preview px, bright-passed (`smoothstep(0.45, 0.95, L)`), weighted to the centre and screened onto the image. It reads the source texture, so it is cheap at 4K (24 taps, no second pass) at the price of a slightly stippled halo on hard edges; the field is smooth, so it is not visible in practice.

**GRADE.** One amount, four looks (`P` punch: S-curve contrast and saturation; `W` warm; `C` cool; `F` fade: lifted blacks, desaturated). One knob and one option group instead of four knobs keeps it in the dial's one-ring-per-effect model.

**WARP.** The field's domain-warp gain was the constant `0.17 × short side`. It is now `FxState.warp` plus `warpScale` (noise frequency 0.85 / 1.7 / 3.4, `LO` / `MID` / `HI`, house = MID). The trick is that every effect's "off" is 0, and the house look must stay the default: so **0 means STD, the house strength** (`WARP_HOUSE = 0.17`), shown as `STD` in the panel and `WARP // STD` on the dial; 1–100 maps to gain `0.17·(v − 1)/49`, i.e. 1 is flat (no warp, a plain radial field), 50 is exactly the house look, 100 is double. Switching WARP on therefore changes nothing until it is turned (`ON_VALUE` 50). It counts in the ON hint and `data-fx`, but `fxNeedsPost` leaves it out, so WARP alone never allocates a framebuffer. Export honours it because the field renderer reads it, not the post pass.

**One dial, every ring.** All enabled effects share the one dial, innermost first in `FX_IDS` order; there are no pages. Up to five rings keep the node gauges' spacing (30 px on a big stage), so the classic dial is unchanged. A sixth ring and beyond lets the stack use the stage's whole short side and tightens the spacing just enough to fit (`(min/2 − 18) / (n + 1.6)`, floor 9 px), so the rings rescale once when the sixth is checked. In practice few effects are on at once; paging can come back if a full stack proves unreadable.

**Panel.** Seven new rows in the same spec-row style, in `FX_IDS` order. The label column grew from 54 to 60 px so HALFTONE fits; option groups are limited to about 110 px, hence the short labels (`PST`, `P W C F`, `LO MID HI`) with full names in `title` / `aria-label`.

**Persistence.** `FxState` gained `halftone, halftoneSize, pixel, ascii, asciiSize, map, mapMode, glow, grade, gradeMode, warp, warpScale`. `parseFx` clamps and defaults each, so old `gh.fx.v1` and CS-06 `fx` objects load with every new effect off and WARP at the house value, i.e. the identical picture.

## v6 — Tools (snap, mirror, eyedropper)

**One module.** `tools.ts` owns the three tools: state is a module singleton (`tools`), so the pointer layer (`handles.ts`), `actions.ts` and the toolbar share it without widening the store. Only SNAP persists (`gh.tools.v1`); symmetry is a per-session mode because its pairs describe the current layout.

**Snap.** `placeNode` is the one place a node position is written during a drag or nudge. Grid = the rulers' own graduation (20 steps a side; `drawRulers`), shown as a faint hairline grid with the 5-step majors a notch stronger (white, `mix-blend-mode: difference`, so it reads on both light and dark field). Alignment to other nodes' x / y within 6 px takes priority and draws a thin SIGNAL line, the only SIGNAL on the board while it is up. The grid fades in only while a snapping drag runs. `⌘/Ctrl` inverts for the drag, nudges never snap. All of it lives in the handles SVG layer (`.tools-layer`, under the nodes), so preview hides it and exports, which render the canvas alone, never see it.

**Mirror.** Groups, not pairs: each member is the group's reference node flipped on x and / or y (`fx`, `fy`), which makes X, Y and XY the same code (a group of 2 or 4). Pairing is greedy by nearest mirrored position within 10 % of the short side, so a slightly asymmetric preset pairs sensibly and snaps exactly symmetric on the first move. Strokes are excluded (their offsets would need flipping, and a stroke is one rigid node by design). Decision: only **position** propagates; colour, radius, softness, shape, delete stay per node, so nothing changes under your hands that you did not touch. The axis is a dashed hairline (6 4) in INK with a black halo, the registration-mark language; the toolbar button prints `OFF / X / Y / XY` after its key and goes VOID plate + SIGNAL while on, like DRAW. Pairs are rebuilt when the mode changes and after a preset or reset; undo / redo restore positions by uid and keep the groups.

**Eyedropper.** `PICK [I]` sits in the COLOUR row (the colour is what it edits). Armed, a capture-phase window listener takes the stage away from the pointer layer (no hover, drag or add while armed), the cursor is the app crosshair everywhere and a loupe chip (a PLATE chip with a swatch and the hex) follows the pointer. The sample is `fieldHexAt` (the colour double-click add uses), computed from the nodes, so it needs no `readPixels` and is independent of DPR; FX are not part of it. `⇧I` hands over to the browser's `EyeDropper` where it exists.

**Keys.** `G`, `Y`, `I` (+ `⇧I`) are suppressed in text inputs, while an FX knob / ring is focused and in preview, like the other shortcuts.

## v6 — Generate

**Intent.** Starting points and exploration without leaving the language of the tool. Everything is a node-level or document-level edit with one undo step, so nothing here is a mode: RANDOM and VARY write into the same history as a drag.

**Toolbar.** A GENERATE group after HISTORY: `Random [R]`, a `Harmony [ANY]` chip and `Vary [V]` (same `.mini.tb-btn`, 1 px VOID divider, still part of the single scrolling row below 960 px). The chip is a cycler rather than a menu: six values, `⇧`-click reverses, the bracket slot shows the current rule. VARY reads as armed (VOID plate, SIGNAL text, the DRAW treatment) while its strip is open.

**RANDOM.** `generate.ts`: mulberry32 seeded from 16 bits, shown as `SEED 4F2A` in the status plate, so a number is a composition. Placement is best-of-18 candidates farthest from everything already placed, with distances in stage px (aspect-corrected), which gives an even scatter with no grid tell. Radii follow `(0.24…0.46)·(9/count)^¼`; the regenerated slots are then ordered by reach, largest first, because soft haze belongs at the back of the layer stack. Colour is OKLCH: hue from the rule around one base hue (a locked node's hue wins), lightness drawn from three bands (dark 28 %, mid 44 %, bright 28 %) so a field never goes muddy, chroma a random share of `maxChroma(L, h)` so every colour is in gamut. Locked nodes are copied through at their layer index; the count never drops below the last locked index. The result goes through `reconcile` index-matched, so colours tween ~600 ms exactly like a preset switch.

**VARY.** Four mutations of the current document at strengths 0.8 / 1.15 / 1.5 / 2 (gentle to bold). VARY has three axes, toggled by checkbox chips under the strip head (any mix, at least one on, default COMPOSITION only): COMPOSITION, COLOURS (shared hue turn, reshuffle, light / dark swing, per-node OKLCH jitter) and EFFECTS (`varyFx`: active amounts ±30·k, option flips, sometimes one more effect on or one of three+ off). With COLOURS off the hexes are untouched. Per-node jitter (position, reach, softness, opacity, rotation) was doubled in v6.1, and each variant may mirror the layout on x / y with probability rising with strength, so the four read as different arrangements of the same nodes. They are rendered one after another with `renderOffscreen` at 240 px on the long side, on a store copy carrying the variant's nodes (FX included, hidden nodes skipped, same packer as the export). The strip is a VOID plate with a GRAPHITE keyline at the foot of the stage, a child of the stage like the node menu (so PREVIEW fades it and the pointer layer never sees its gestures): mono header `VARIATIONS // 04 // SEED …`, four keylined thumbnails at the stage's aspect with `V-n` serials bottom-left and the `1`–`4` key bottom-right, SIGNAL keyline on hover / focus. It closes on `Esc`, on a click elsewhere, and on any edit (the thumbnails would be stale), and adoption restores by uid, so identity and selection survive.

**LOCK / HIDE / SOLO.** Two optional booleans on every node (`lock`, `hide`; in history snapshots, in CS-06 only when true, so old saves are byte-identical). Lock is enforced at three layers: the pointer layer refuses to start any drag on a locked node (the press only selects, or opens the hold menu on touch), the gauges and COLOUR page are not shown or hit-testable, and `Actions` guards radius, softness, opacity, rotation, shape and colour (every refusal says `N-03 · LOCKED · L to unlock` on the status plate). Lock is visible as a 7 px padlock off the reticle's top-right corner and a `· LOCK` suffix on the coordinate tag. Hide is applied in `packField` (live frame and export share it), which compacts the visible nodes down to the front of the buffers keeping layer order; `fieldHexAt` skips them too, so a double-click add samples what you see. The reticle of a hidden node is ghosted: dashed brackets at 70 %, a hollow core. The last visible node cannot be hidden; SOLO remembers what was hidden before so a second press puts it back.

**Palette extract.** `extract.ts`: 2D canvas downsample (≤ 96 px, transparent pixels ignored), k-means++ in OKLab with a fixed seed (the same image always yields the same palette), 14 Lloyd iterations, sorted by OKLab lightness. Applied lightest-to-top (nodes ordered by y), which reads as a sensible wallpaper ramp whatever the layout. A file dragged over the stage shows a dashed SIGNAL `DROP IMAGE → PALETTE` overlay. Everything is local: `Image` from an object URL, revoked after decode.

**New sets.** CS-21 … CS-25 (HULL BREACH, AFTERBURN, ICE CORE, RELAY GHOST, SALT FLAT) are built-in showcases for shapes, strokes and softness / opacity variety; two carry FX built on `FX_DEFAULT`. Serials are kept apart from CS-06 … CS-13 so the save library can claim those.

## v6 — Output

Everything that leaves the app other than the Export download: a link, the clipboard, code and a save library. Four additions, one rule: **one document schema**. `serialiseDoc` / `parseDoc` in `custom.ts` (the CS-06 `{v:2,…}` node format plus `fx`, and for links and JSON also the wallpaper target) are the only serialiser / parser; CS slots, share links and the JSON tab all go through them, and `parseFx` / `copyFx` own the FX fields. A field added to a node or to `FxState` flows into all four with no change here.

**Toolbar.** The right-pinned group is now OUTPUT: `Share [U]` · `Copy [C]` · `Code [X]` · `Export [↓]` (Export keeps the VOID / SIGNAL plate; the others are the ordinary `.mini.tb-btn` ghosts). A success flips the label to `Copied` on the SIGNAL `is-done` plate for 1.5 s, like Export does. The status plate floats left of the whole group. U, C, X are suppressed in text fields, on FX knobs and in preview, like the other shortcuts, and are inert while the CODE panel is open.

**Share link.** `#g1=` + base64url JSON, or `#g1z=` + base64url deflate-raw JSON (`CompressionStream`, only when it is actually smaller; unsupported browsers just get the plain form and cannot read `g1z` links, which is reported as an unrecognised link). Chosen over a server or `localStorage` because the document is tiny (a nine-node field is ~370 characters) and a link has to work anywhere. The hash is applied as one undo step (`LINK`), not as a silent initial state: opening a link over your own work is reversible, and `UNDO` is right there in the toolbar. The wallpaper target is applied too (not undoable, like the panel). The hash is removed after loading so a later reload does not replay a stale link; `#top` / `#spec` anchors are untouched (only `#g1…` is ours). The clipboard write is issued with a promise of the text (`ClipboardItem` with a `Promise<Blob>`) so Safari accepts it after the async compression.

**Copy PNG.** The quick-export render (2048 px long side via `renderOffscreen`, FX included) written with `new ClipboardItem({'image/png': blobPromise})`; the promise is handed to the clipboard inside the click so Safari keeps the user activation while the GPU works. No API / insecure context: a status line, nothing else.

**Save library.** CS-06 grew into eight slots CS-06 … CS-13, preset indexes `CUSTOM_INDEX + k` (`store.slots`; `store.custom` stays an alias of slot 0 so existing readers keep working). The panel keeps the five factory rows as rows and puts the library below them as a 4-up grid of thumbnail cards (2-up under 420 px): 3:2 thumb with a 1 px edge outline (dashed and dimmed when empty), serial in the mono caption, `MOD` tag when edited, and two small ghost buttons under each card, `[↧]` save here and `[×]` clear. The active card is the black plate with SIGNAL text like an active preset row. Thumbnails are a 112 px PNG from the same offscreen renderer as export, stored as a data URL beside the set (8 × ~10 KB); if the write exceeds the quota the thumbnails are dropped and the sets kept; a failed render leaves the colour-chip strip, which is also what migrated sets show. Two-press confirm is unchanged in feel (FLARE plate, `[×]?`, 3 s, Esc / blur cancel) and now one generic arm-button helper serves the header CLEAR and every card. Header SAVE targets the active slot, else the first empty one; a full library asks you to pick a card (no silent overwrite). **Migration:** `gh.slots.v1` is new; when it does not exist the v5 `gh.custom.v1` is parsed into slot 0 once. The old key is left in place, untouched, so rolling back loses nothing.

**Code panel.** A native modal `<dialog>` (page inert, focus held inside, `Esc` closes, focus returns to the opener) in the spec-sheet language: black head plate with the SIGNAL title and `CLOSE [×]`, mono tabs (the active one a black plate), a black code well in `--plate-fg`, a meta line (`181 LINES · 6.4 KB`) and `COPY GLSL [⧉]`. While it is open a window-capture key listener owns the keyboard (nothing reaches the editor; browser defaults such as ⌘C and scrolling still work). GLSL is not a copy: it imports `VERT` / `FRAG` / `WARP` from `gradient.ts` and the uniform values come from `packField` at the wallpaper target with the exporter's area-matched unit, so it cannot drift from the renderer. CSS and SVG are drawn from the same weight function the shader uses (`coreWeight`, `softTail`, `LAYER_K`, from `color.ts`), sampled as an alpha profile; the base colour is the field's far-field value (`sampleField` at q = 3). **They are approximations, and the panel says so in FLARE on the first line of the note:** no OKLab blend, no warp, no FX, CSS cannot rotate (rotated shapes snap to the nearest axis), boxes become circles, strokes a chain of up to 12 circles (SVG: a blurred polyline group, so the blur filter is optional by deleting one attribute). Sizes are px for the wallpaper target.

**FX dial ADD / REMOVE (v6.1).** Every control at the cursor: the dial shows only the effects that are on, and adds / removes them in place. A square `+` chip sits one ring spacing under the outermost label (the 180 bearing gives way to it); it opens the node menu's plate beside it, right-click style, listing the effects that are off. Each label chip carries a FLARE `×` square on its right (VOID plate, FLARE keyline and glyph; filled FLARE on hover) that switches the effect off. Both are hit-tested by coordinates before the rings, since they sit inside a ring's band. While the menu is open the dial does not idle-dismiss, and a press anywhere off the menu only closes it.

**Move dims too.** Dragging a node (past the click slop) sets `ui-focus` with `focus-node`: other nodes, chips and the FX dial dim to 20 % as for a size or gauge drag; the moving node keeps its reticle and ring but drops its gauges, and the coordinate tag and the tools layer (snap grid, guides, mirror axis) stay at full strength.

**Magnetized = engaged (v6.1).** A hovered gauge (node OPAC / SOFT / ROT, the COLOUR page's HUE / SAT / LUM, every FX dial ring) now takes the FLARE engaged colours at once: label chip, fill, knob and ticks, the same as a drag or a wheel burst. It used to show SIGNAL until the first scroll tick, which read as two different states for one gesture.

**Value chip (v6.1).** Every gauge (node OPAC / SOFT / ROT, HUE / SAT / LUM, FX dial rings) carries its value (`74`, `045°`, `9 LV`) on a small straight plate centred on its own arc at the value and turned along the arc's tangent (flipped on the lower half so the number never reads upside down), so it travels round with the knob; near either end it is held inside the sweep so `0` / `100` never run into the name chip. VOID plate, INK number; FLARE with VOID number while the gauge is magnetized, dragged or wheeled. (A curved band with the number on a `textPath`, an upright plate and a knob-attached flag were tried: a straight plate laid along the arc reads best.) The label chip in the bottom gap reads `NAME[value]` (`OPAC[55]`, `GRAIN[OFF]`) instead of `NAME // value`; the gap is sized for the name plus a typical bracketed value; both come from the one `NAME // value` label `renderGauge` receives, so callers are unchanged. Older notes and README rows that quote `SOFT // 50`-style chips describe that label string, not what the chip shows.

**Aligned sweep (v6.1).** Gauges no longer share a fixed 270°; each stack computes one bottom gap and every ring in it ends on that same bearing. `gaugeGap` finds how much room one ring needs so its ends clear its own `NAME[value]` chip (plus the FX dial's × square): the end may pass beside the chip or stop above it, whichever comes first. `stackGap` takes the largest over the stack (the FX dial's shown rings; a node's OPAC / SOFT / ROT, shared with LUM / SAT / HUE so both pages match), so in practice the innermost ring sets it and the stack reads as one aligned instrument; travel stays between 270° and 340°. An earlier per-ring gap (each ring stopping just short of its own name) looked ragged and was dropped. Ticks, fill, knob, value chip, the COLOUR page's painted tracks and every pointer mapping (`sweepT` in the FX dial, `arcT` in handles.ts) read the gauge's `sw`, so dragging still lands under the pointer. The value chip stays inside the sweep near the ends, so `0` / `100` never run into the name.

**Engaged dim (v6.1).** Beyond the `ui-focus` dim during a drag or wheel burst, the artboard now also steps back while something is merely in hand: with a node hovered or selected in the edit tool (hover wins), every other node drops to 20 % (`.stage.node-engaged`, the selected node carries `.is-engaged`); with the FX dial open, every node does (`.stage.fx-open`). Same `filter: opacity(0.2)` as `ui-focus`, so the two never fight; the canvas, coordinate chip and tools layer stay at full strength, and dimmed nodes stay clickable.

**Snappier hand-off between dials (v6.1).** A wheel burst on a node gauge used to hold its zone lock (400 ms) and its `ui-focus` dim (700 ms) even after the pointer had moved onto another gauge, so the grey-out lagged the FLARE hover by up to a second. Now any real pointer move onto a different control (another gauge, the ring, the core, or off the node) ends the burst at once, including its 900 ms FLARE flash on the gauge that was wheeled; the next wheel tick starts a fresh one on the new dial. Scrolling without moving still keeps the zone, so trackpad inertia never flips dials mid-scroll. The FX dial already ended its burst on the first real move.
Colour on the gauges no longer fades: FLARE / INK flip on the frame the gauge is magnetized or released (the 160 ms `--t` stroke and chip fades read as lag); only stroke weight eases (80 ms). The dim between gauges inside a bezel or the FX dial now trades in 60 ms both ways (was 100 ms in / 200 ms out).

**GENERATE in the foot, shortcuts in a popup (v6.1).** RANDOM / HARMONY / VARY left the toolbar (it no longer needs a second row for them) and sit centred in the artboard's foot line in the FX DIAL / PREVIEW corner-button style: they act on the artboard, so they live on its frame. The always-on shortcut strip became `Shortcuts [?]`: a vertical key → action list in the node menu's plate that opens upward from the stage bar, so the bar under the artboard is quiet by default. On touch the foot row grows (`--foot-row: 62px`) so the 36 px buttons drop under the readouts.
`SHORTCUTS [?]` now uses the corner-button type (mono caps, 20 px) like FX DIAL / PREVIEW. Hover peeks the list (a 180 ms grace bridges the gap to the popup), a click or `?` pins it (`aria-pressed`, VOID / SIGNAL like PREVIEW on). Rows read action → key: the description on the left, the key chip on the right.

**The artboard carries its own controls (v6.1).** NODES (ADD NODE · REMOVE NODE · DRAW) sit centred on the frame's top edge between FX DIAL and PREVIEW; TOOLS (SNAP · MIRROR) join GENERATE in the foot line, a hairline between the two groups. All in the corner-button type. The toolbar keeps only HISTORY and OUTPUT, so it fits one row again at laptop widths. The foot is a `max-content | 1fr | max-content` grid so the cursor readout and stage size never wrap. On a phone NODES take their own row above the corners (`.stage-area` top padding 94 px) and the foot buttons wrap (`--foot-row: 104px`). All of them hide in PREVIEW with the rest of the frame furniture.

**Artboard menu (v6.1).** Right-click on the board away from any node opens `BoardMenu` (menu.ts), the node menu's plate with ADD NODE `[+]` (the double-click add at that point, mirror-aware) and DRAW `[D]`. It replaces the browser's own menu, which used to appear there; a right-click on a node still opens the node menu.
While the artboard menu is open a small SIGNAL triangle (black halo) stands on the right-click point, its tip on the exact spot ADD NODE will use; it sits above the point so the menu, which opens below-right, never covers it.
