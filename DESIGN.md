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
for every shape; a stroke's reticle sits at its centroid. Non-circle nodes show a dashed
dual-stroke outline of their core (SIGNAL while the body is hovered or dragged).

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
highlight. Hit band ±7 px (±11 coarse) around `ri`, on the visible arc plus a band-sized tolerance at the ends.
Priority: **core > SOFT gauge > ring band > body > empty**; the gauge (≤ r − 11) and the ring band (≥ r − 10) barely meet.
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
