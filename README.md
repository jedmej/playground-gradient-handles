# Gradient handles

A mesh-gradient *handle study*. Two to sixteen colour nodes (nine to start) sit on a WebGL field; each one
has a position, a colour and an influence radius. The point of the demo is one
interaction detail: grabbing a node and grabbing its influence ring are two
different things, and the cursor tells you which one you are about to do.

- Hover a reticle → its influence ring (a graduated bezel) appears.
- Move onto the ring band → the system cursor disappears and a short bearing arc
  slides around the ring at your angle.
- Drag that arc → the radius follows the pointer (red-orange while engaged,
  with a live `R 184PX` readout). Release to keep it.
- Drag the reticle core → the node moves, with a `N-05 // X 0.512 Y 0.430`
  readout.

Visual direction follows the spec-sheet / retro-futurist language of Bungie's
*Marathon* site (acid lime rail, black bars, mono serials, registration marks,
hard edges) without any of its trademarks or assets. See `DESIGN.md` for the
token system and the critique that shaped it.

## Controls

| Input                      | Action                                                      |
| -------------------------- | ----------------------------------------------------------- |
| Hover / drag reticle core  | Move node                                                   |
| Hover / drag ring band     | Change radius (cursor hides, arc shows)                     |
| Tap reticle (touch)        | Select node; shows its ring and an arc affordance           |
| Drag on ring (touch)       | Change radius                                               |
| `Tab`                      | Focus next node                                             |
| `← ↑ → ↓`                  | Nudge 1 px (`Shift` = 10 px)                                 |
| `[` / `]`                  | Radius −/+ 4 px (`Shift` = 16 px)                            |
| `Esc`                      | Deselect                                                    |
| Double-click empty field   | Add a node there (colour = field under the point)           |
| Double-tap (touch)         | Same, two taps within 380 ms and 36 px (mouse: 320 ms / 24 px)  |
| `Add node` button          | Adds a node at the emptiest spot (max 16)                   |
| `Delete` / `Backspace`     | Remove selected node (min 2)                                |
| `Remove node` button       | Same                                                        |
| Tap, then hold a selected core (touch, 550 ms) | Remove it; FLARE arc shows progress on the armed hold only, moving > 6 px cancels |
| Colour swatch / HEX field  | Recolour the selected node (OKLab tween); Enter/blur commit, Esc reverts |
| Palette strip chip         | Select that node                                            |
| `SAVE [↧]`                 | Store the field in CS-06 (`localStorage` key `gh.custom.v1`) |
| `CLEAR [×]` (twice in 3 s) | Delete the saved CS-06 set; the row goes back to `CUSTOM — EMPTY` (Esc cancels) |
| `⌘/Ctrl+Z`, `⇧⌘/Ctrl+Z`    | Undo / redo (50 steps): add, remove, colour, drags, presets |
| Colour set rows            | Switch preset; colours tween in OKLab over ~600 ms          |
| Export PNG                 | Downloads the field only (no handles) at 2048 px long side  |
| Reset                      | Restores the current preset's positions and radii           |

Grab-zone priority is deterministic: node core beats ring band beats empty
canvas, and among overlapping candidates the nearest wins. Ring bands are only
grabbable on rings that are visible (hovered, selected or focused), so a hidden
ring never steals the cursor.

Respects `prefers-reduced-motion` (smoothing and transitions snap) and
`(pointer: coarse)` (larger hit zones).

## Field

WebGL1 fragment shader. A slow low-frequency domain warp bends the sample
position first, so seams between nodes curve instead of forming a plaid. Each
node then contributes a gaussian weight with a small inverse-distance tail,
normalised, blended in OKLab, then converted back to sRGB with animated film
grain to kill banding. Device pixel ratio is capped at 2. Export renders the
same warp at the moment you press the button.

## Development

```sh
npm install
npm run dev       # vite dev server
npm run build     # typecheck + static build to dist/
npm run preview   # serve dist/
```

Fonts are self-hosted via `@fontsource` (Big Shoulders Display, Inter Tight,
Martian Mono). No runtime network calls beyond same-origin assets.

### Test hooks

- New in round 3: `<html>`/`<body>` `data-node-count`, `data-selected`;
  `[data-action="add-node|remove-node|save-custom|clear-custom|undo"]` (clear has `data-armed`), `[data-preset="cs06"]`,
  `[data-testid="node-color|node-hex|palette"]`, `[data-testid=palette] button[data-chip][data-hex]`.
- Each handle: `[data-node="0–15"]` with live `data-x`, `data-y` (client px of
  the centre) and `data-radius` (CSS px).
- `<html>` (and `<body>`): `data-hover-state="idle|node|ring"`,
  `data-drag="none|node|ring"`.
- Preset buttons: `[data-preset="cs01"…"cs05"]`. Export: `[data-action="export"]`.
- Canvas frame: `[data-testid="stage"]`.

## Credits

Handle mechanic after Isaiah (@eyexayuh)'s mesh-gradient node controls.
Built for Jędrzej Mejzner / NEWFRAME.
