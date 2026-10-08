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
| `-` / `=` (also `+`, numpad −/+) | Radius −/+ 4 px (`Shift` = 16 px) on the selected / focused node; bursts coalesce into one undo step |
| Scroll / two-finger scroll over a node | Radius (`r *= exp(−Δy · 0.0015)`; fingers up = bigger). Trackpad pinch (`ctrl` + wheel) is the same ×3. Never scrolls or zooms the page while over a node; over empty field the page behaves normally |
| `⇧` or `⌥` + scroll over a node | SOFT −/+ (`soft −= Δ · 0.0012`; fingers up = softer); one `SOFT N-xx` undo step per 700 ms burst |
| SOFT gauge (middle 270° arc of the node's gauge stack) | Drag it to set the node's softness 0–100 %. The three gauges are the FX dial's rings: fixed radii round the core (OPAC 45 px, SOFT 75, ROT 105 on a full-size stage — the FX dial's own spacing, innermost first), independent of the node's size, each with its own `SOFT // 50` chip in the bottom gap. Visible with the bezel on any node size; hidden in draw mode |
| ROT gauge (outermost of the stack, same 270° arc: 0–360° maps along it, wraps past the end) | Drag along it to set the node's angle (`Shift` snaps to 15°); `ROT // 045°`; one `ROT N-xx` undo step per drag. Ellipse / box / capsule only |
| OPAC gauge (innermost 270° arc, SOFT's twin) | Drag to set the node's opacity 0–100 % (`OPAC N-xx`). Its pull on the field fades toward its neighbours. All shapes, strokes included |
| Scroll over a gauge band (anywhere else on the node, including the gap between the gauges and the size ring, resizes it) | **One rule for every wheel control: fingers up on a natural-scrolling trackpad (deltaY > 0) = more, fingers down = less; one constant `WHEEL_SIGN` flips it** (ROT: up = clockwise; pinch out = bigger; shared helper `wheelUp` in `src/wheel.ts`). Plain scroll is hit-tested per zone like `pick()`: over the SOFT gauge it sets softness, over the ROT dial it rotates (~4° / notch), over the OPAC gauge it sets opacity; elsewhere on the node it resizes. A burst keeps its zone; one undo step per burst. The cursor hides while wheeling a gauge; the rest of the artboard UI dims while any dial is in use |
| Click (press and release without moving) the node's core, `Enter` on a focused node | Flips that node's bezel to the **COLOUR page**: OPAC / SOFT / ROT collapse and three gauges grow in on the same radii, **HUE** (outer; the track is the hue wheel, `HUE // 145°`), **SAT** (grey → the most vivid colour at this lightness, `SAT // 80`) and **LUM** (inner; black → white, `LUM // 62`), with a swatch chip at the core. Drag or scroll them like any gauge (wheel: up = more; ~25° of hue or ~10 % per notch); the canvas, panel swatch and hex follow live; one `HUE N-xx` / `SAT` / `LUM` undo step per drag or wheel burst. Click the core again, `Esc`, or click off the node to go back (`Esc` first leaves the page, then deselects). Only one node is on the page at a time; a drag on the core still moves the node; touch: tap the core. Strokes included. Colours are OKLCH (SAT is a share of the in-gamut maximum), so dials stay perceptually even and always land on a valid sRGB hex |
| `OPAC` row `[−]` `[+]` | Opacity −/+ 10 % |
| `SOFT` row `[−]` `[+]`      | Softness −/+ 10 %                                            |
| `]` / `[`                  | Layer up / down (`⇧]` bring to front, `⇧[` send to back). Layer = array order = serial `N-xx` = Tab order; the node stays selected |
| Right-click a node (`ContextMenu`, `Shift+F10` on a focused node) | Node menu: BRING TO FRONT · MOVE UP · MOVE DOWN · SEND TO BACK · DELETE. ↑/↓ move, Enter/Space activate, Esc / click outside / scroll closes |
| `Esc`                      | Deselect                                                    |
| Double-click empty field   | Add a node there (colour = field under the point)           |
| Double-tap (touch)         | Same, two taps within 380 ms and 36 px (mouse: 320 ms / 24 px)  |
| `Add node` button          | Adds a node at the emptiest spot (max 16)                   |
| `Delete` / `Backspace`     | Remove selected node (min 2)                                |
| `Remove node` button       | Same                                                        |
| Tap, then hold a selected core (touch, 550 ms) | Opens the node menu beside it (SIGNAL progress arc on the armed hold only, moving > 6 px cancels). Removing on touch = tap → hold → `DELETE`. Holding an unselected node does nothing |
| Two-finger pinch (touch, node selected) | Scales that node's reach from where the pinch started; one `RADIUS` undo step. A second finger cancels any one-finger drag / hold / stroke |
| `D` / `DRAW [D]` button    | Draw mode (crosshair everywhere, nodes not hit-tested). Press-drag paints one freehand stroke, release simplifies it (≤ 64 pts), selects it and leaves draw mode. `Esc` exits. Touch: the `DRAW` toggle on the stage foot line |
| Drag a stroke / shape body | Hover shows an open hand; dragging anywhere on a stroke (or inside an ellipse / box / capsule core) moves the whole node. One undo step `MOVE N-xx` |
| `SHAPE` row                | Circle / ellipse / box / capsule for the selected node (undo step `SHAPE N-xx`). Disabled for strokes, which show `STROKE · nn PTS` |
| `ROT` `[−]` `[+]`, `,` `.` | Rotate ellipse / box / capsule 15° (`Shift` = 45°); bursts coalesce into one undo step |
| Colour swatch / HEX field  | Recolour the selected node (OKLab tween); Enter/blur commit, Esc reverts |
| Palette strip chip         | Select that node                                            |
| `SAVE [↧]`                 | Store the field in CS-06 (`localStorage` key `gh.custom.v1`) |
| `CLEAR [×]` (twice in 3 s) | Delete the saved CS-06 set; the row goes back to `CUSTOM — EMPTY` (Esc cancels) |
| `P` / `PREVIEW [P]` button (above the artboard's top-right corner) | Bare wallpaper: fades out (≈ 200 ms, instant under reduced motion) every node, ring, gauge, chip, stroke overlay, the FX dial, the rulers, corner marks and foot readouts; the gradient keeps rendering with its FX at the wallpaper aspect. The stage is inert while on (no drags, dial, wheel, double-click add, no edit keys). `Esc`, `P` or the button exits. Not persisted |
| `⌘/Ctrl+Z`, `⇧⌘/Ctrl+Z`    | Undo / redo (50 steps): add, remove, colour, drags, presets |
| Colour set rows            | Switch preset; colours tween in OKLab over ~600 ms          |
| FX knob (GRAIN · DITHER · CHROMA · SCAN · VIG) drag | Up / right = more, ≈ 160 px for the full range. One undo step per drag |
| FX knob scroll             | ~1 step per 12 px, wheel up = more; a 700 ms burst is one undo step. Never scrolls the page while over a knob |
| FX knob focused            | `← ↓` / `→ ↑` ±1 (`Shift` ×10), `PageUp` / `PageDown` ±10, `Home` OFF, `End` max. Global shortcuts are suspended while a knob has focus |
| FX knob double-click / double-tap | Toggle OFF ↔ last non-zero value (first time: half way round the knob — 50, dither 9 LV) |
| FX checkbox (left of each effect) | Same toggle as the double-click, one undo step; reflects the knob live (0 = unchecked). `Space` when focused |
| `FINE`/`COARSE`, `BAYER`/`BLUE` | Grain size and dither pattern; one undo step each, clickable while the effect is off |
| `ALL OFF [×]`              | Switch every effect off (undo step `FX OFF`) |
| Click / tap on empty board (also `⌥`+scroll, `F`, `FX DIAL [F]` foot button) | FX dial opens centred at the cursor (after 240 ms, so a double-click still adds a node and cancels it), clamped inside the stage. One concentric 270° ring per enabled effect (GRAIN · DITHER · CHROMA · SCAN · VIG, innermost first) inside a dashed bezel with ticks and 000/090/180/270 bearings, a corner-bracket reticle at the click point and a black mono tag per ring (`GRAIN // 50`). Clicking anywhere off a ring while it is open (empty board, a node, the dial's centre or gap) closes it and the click acts normally (deselect, node grab); the next empty click opens it again. With a node selected (or a menu / stroke active) the first click only deselects; the next one opens the dial. Not opened in DRAW mode or after a drag. `F` / the button use the cursor when it is over the stage, else the stage centre. Over a node `⌥`+scroll still tunes SOFT |
| FX dial ring: hover / drag / scroll | Hover thickens that ring and dims the rest. Drag round it like a knob (one undo step); scroll steps it (~1 per 12 px, bursts coalesce), with or without `⌥`, and nodes do not resize while the dial is open. Dragging to 0 turns the effect off but keeps the ring until the dial closes. Panel changes and new checkmarks update the dial live |
| FX dial focus | Rings are sliders: `Tab` between them, `← ↓` / `→ ↑` ±1, `⇧` ×10, `PageUp/Down` ±10, `Home` OFF, `End` max |
| FX dial dismiss            | `Esc`, `F`, a click off the rings, or the pointer parked well away from it for 1.5 s. Clicking the panel does not close it |
| WALLPAPER targets          | PHONE 1290×2796 · LAPTOP 2560×1600 · 4K 3840×2160 · ULTRA 5120×2160 · SQUARE 2048×2048 · CUSTOM (W × H inputs, 16–16384 px per side, clamped on Enter/blur, ⇄ swaps; first use starts from the selected preset). Picking one reshapes the artboard to that aspect (fit and centred), so the stage is what exports. Not an undo step, but remembered |
| Export wallpaper           | Renders the field + FX at the target size (`GH-CS01-4K-3840x2160-2041.png`). If the GPU cannot allocate it the button says `Too large`, the status line gives the real limit, and nothing downloads |
| Export PNG                 | Downloads the field (FX included, no handles) at 2048 px long side |
| Reset                      | Restores the current preset's positions and radii           |

Grab-zone priority is deterministic: node core beats the ROT dial, OPAC and SOFT gauges, which beat ring band beats body beats empty
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

FX are an optional post pass. With everything off the field draws straight to the canvas (no framebuffer). With any FX on, the field renders into a texture and one fullscreen shader applies chromatic aberration → vignette → scanlines → grain → dither. Grain is **seeded and static** (no time term), so an export matches the preview. Pattern cells are authored in preview CSS px and scaled by `fxUnit` (buffer px per preview px), so a 4K export looks like the preview at viewing size. Wallpaper targets reframe by *cover-fit, keep node positions relative*: nodes keep their `(x·W, y·H)` positions and every size (radii, stroke offsets, warp) uses the area-matched unit `u = min · √(W·H / (stageW·stageH))`. FX and the wallpaper target persist in `localStorage` `gh.fx.v1`; CS-06 stores its FX too (optional `fx` field, still `v:2`).

Each node has a softness (0–1, default 0.5; strokes start at 0.75) that reshapes its weight
(`exp(−1.5·q^p) + tail/(1+q⁴)`; 0.5 is the classic gaussian). Nodes are also layers: after the soft average the
shader mixes each node's core over it in array order, back → front (`LAYER_K = 0.85`), so overlapping nodes stack
while edges stay soft. See `DESIGN.md` "Round 4b".

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
- Round 4: `[data-node]` also carries `data-shape="circle|ellipse|box|capsule|stroke"` (and `data-pts` = point count for
  strokes); `html[data-tool="edit|draw"]`; `data-hover-state` gains `body`; `#draw-guide` (visible only while drawing);
  `[data-action="draw-mode|rot-minus|rot-plus"]` (two `draw-mode` buttons exist, the stage-foot one only on coarse
  pointers); shape picker `.shape-btn[role=radio][data-shape]`. Note `[data-shape]` also matches the picker buttons,
  so scope node queries as `[data-node][data-shape=…]`. CS-06 storage is `{v:2,…}` (v1 still loads).
- Round 4b: `[data-node]` also carries `data-soft` (0–100, the target value) and `data-layer` (1-based, back = 1);
  `data-hover-state` / `data-drag` gain `soft`; panel `#ns-soft`, `#ns-layer` (`LYR 03/07`), `#soft-bar` (10 `<i>`,
  `.is-on` = filled) and `[data-action="soft-minus|soft-plus"]`. The node menu is `[data-testid="node-menu"]`
  (always in the DOM, `hidden` while closed; `role=menu`, items `role=menuitem`) with items
  `[data-action="layer-front|layer-up|layer-down|layer-back|menu-delete"]`. CS-06 nodes carry `soft` only when it
  differs from the shape default (0.5, strokes 0.75). The radius keys moved from `[`/`]` to `-`/`=`.
- v4: `html[data-fx]` / `body[data-fx]` = active effects in fixed order (`grain,dither,chroma,scan,vig`, empty when none);
  `[data-fx-knob="grain|dither|chroma|scan|vig"]` (`role=slider`, `aria-valuenow` = raw state: 0–100, dither 0 or 2–16);
  `[data-fx-opt="grain-fine|grain-coarse|dither-bayer|dither-blue"]` (`aria-checked`); `[data-fx-check="grain|dither|chroma|scan|vig"]` (native checkbox, `aria-label` “Grain on” …); `[data-action="fx-off"]`;
  `#fx-hint` (`— ALL OFF` / `— 2 ON`); `[data-wp="phone|laptop|4k|ultra|square"]` (`role=radio`, `aria-checked`);
  `[data-action="export-wallpaper"]`; `#wp-dims`; `localStorage` `gh.fx.v1` = `{v:1, fx, wp, cs:{w,h}}` (`cs` optional on read).

## Credits

Handle mechanic after Isaiah (@eyexayuh)'s mesh-gradient node controls.
Built for Jędrzej Mejzner / NEWFRAME.
