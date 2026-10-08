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
