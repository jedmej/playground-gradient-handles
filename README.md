# Gradientlabs

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

## Layout

The stage column is three bands: a **toolbar** (`#toolbar`), the artboard area, and a **stage bar** (`#stage-bar`).
Toolbar groups, in order: HISTORY (`Undo [↶]`, `Reset [↺]`), then OUTPUT (`Share [U]`, `Copy [C]`, `Code [X]`, `Export [↓]`) pinned to the far right; the status plate floats just left of it. `FX DIAL [F]` (top-left)
and `PREVIEW [P]` (top-right) are small corner buttons riding the artboard frame, with NODES (`ADD NODE [+]`, `REMOVE NODE [−]`, `DRAW [D]`, `.frame-top`) centred between them on the same edge (on a phone, a row above them); TOOLS (`SNAP [G]`, `MIRROR [Y]` + its mode) and GENERATE (`RANDOM [R]`, `VARY [V]`), one `.foot-gen` row with a hairline between the two, sit in the same corner-button style centred in the artboard's foot line, between the cursor readout and the stage size. The stage bar holds `SHORTCUTS [?]` (`#keys-btn`, corner-button style): hovering it peeks the key list as a vertical popup (`#keys`, the node menu's plate, action on the left and key on the right; touch shows the gesture list) and leaving hides it again; a click or `?` pins it open (`aria-pressed`) until a second click / `?`, `Esc` or a press outside. The right panel keeps the contextual
controls only, as collapsible sections under the REV plate: COLOUR SET, SAVED SETS, FROM IMAGE, NODE, FX and WALLPAPER
(see *Panel sections*). The top bar holds the NEWFRAME mark, the GRADIENTLABS title, a HUD strip (see *Top bar*) and
`DARK` / `PANEL`. Below 960 px the toolbar is one
horizontally scrolling row, GENERATE drops under the foot readouts, and status messages float as a toast. In preview the toolbar, FX DIAL, the foot line (GENERATE included) and the stage bar hide;
PREVIEW stays.

### Panel sections

Each block of the spec panel is its own section: COLOUR SET (the built-in sets), SAVED SETS (CS-06 … CS-13, with
`SAVE` / `CLEAR` in its header), FROM IMAGE, NODE, FX and WALLPAPER. A click anywhere on a section's header row (or
`Enter` / `Space` on its title) collapses or expands it; header actions (`SAVE`, `ALL OFF`) keep their own clicks. The
header is a fixed-height row: a state square (hollow collapsed, filled open), the title and its live hint, the actions,
and a chevron plate (down collapsed, up open). An open section's rule carries a short index tab. Collapsed sections are
remembered (`localStorage` `gh.sections.v1`).

### Top bar

Between the title and `DARK` / `PANEL` sits a HUD strip: a hazard block, a tick rail whose SIGNAL cursor follows the
pointer's x across the stage (hidden while the pointer is off it), and the node meter: one cell per possible node
(16), SIGNAL = in use, PAPER = the selected node, with a `09/16` count. The rail is dropped below 960 px.

## Controls

| Input                      | Action                                                      |
| -------------------------- | ----------------------------------------------------------- |
| Hover or select a node / open the FX dial | The other nodes (every node, for the dial) dim to 20 % while it is in hand; they stay clickable |
| Hover / drag reticle core  | Move node (past the click slop the rest of the artboard UI dims, like a size or gauge drag; the coordinate tag and snap guides stay) |
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
| Right-click the artboard off any node | Artboard menu (`[data-testid="board-menu"]`, the node menu's plate): ADD NODE `[+]` (adds at the click point, same as a double-click there: colour = field under the point, mirror partners too) · DRAW `[D]` (enters draw mode). ↑/↓ move, Enter activates, Esc / click outside / scroll closes. Disabled items: ADD at 16 nodes |
| Right-click a node (`ContextMenu`, `Shift+F10` on a focused node) | Node menu: BRING TO FRONT · MOVE UP · MOVE DOWN · SEND TO BACK · LOCK / UNLOCK · HIDE / SHOW · SOLO / UNSOLO · DELETE. ↑/↓ move, Enter/Space activate, Esc / click outside / scroll closes |
| `R` / `RANDOM [R]` button  | Hover peeks the strip (it closes once the pointer has left the button and the strip); a click or `R` pins it until a click off it, `Esc` or a second click (same for `VARY [V]`; hovering one while the other peeks switches mode). It shows **four** fresh compositions to pick from (`1`–`4` or click; `Esc` closes). Reopening shows the same four: a new set only comes from `ROLL [R]` (top-right of the strip, `[data-action="vary-roll"]`), `R` pressed while the strip is open, or a chip change; editing the field also invalidates the set. VARY behaves the same with `ROLL [V]`. Each: 5–10 nodes spread with decent spacing (best-candidate placement, measured in stage px), radii scaled to the count, big hazy nodes sent to the back, occasional ellipse / box / capsule and a little transparency, colours from a harmony rule in OKLCH (L spread dark / mid / bright, chroma a share of the in-gamut maximum). **Locked nodes are kept untouched** at their layer index (and set the base hue). Picking one tweens ~600 ms like a preset switch; one undo step `RANDOM`; the status line shows its rule and seed (`RANDOM · TRIAD · SEED 4F2A`; a seed is a repeatable composition) |
| `VIEW` eye toggle (RANDOM / VARY strip, beside ROLL, `[data-action="vary-view"]`) | On by default (switching it off is remembered in `localStorage` `gh.vary.view.v1`): hovering or focusing a thumbnail lays that take full size over the whole artboard (`.vary-full`, rendered once at the stage's own resolution and cached); hover away and the field underneath is back. Only a preview, nothing is applied |
| SAVE chip on a RANDOM / VARY thumbnail (top-left, `[data-vary-save="0–3"]`) | Saves that take straight into the first empty library slot (with its own thumbnail) without adopting it: the field, active set and undo history are untouched; status `R-3 → CS-08`. The chip stays SIGNAL for a saved take. Library full → `LIBRARY FULL — clear a slot first`, nothing overwritten |
| Padlock on a RANDOM / VARY thumbnail (top-right, `[data-vary-lock="0–3"]`) | Locks that take: it keeps its slot and image through every roll (`R` / `V` again), chip change and reopen, until unlocked; the others keep changing. RANDOM and VARY lock separately. Locked = SIGNAL padlock and outline. Not persisted across reloads |
| Harmony chips (RANDOM strip head) | Radio chips choose the rule: `ANY` · `ANALOG` (±35°) · `COMPL` (base and its opposite) · `TRIAD` (120° steps) · `SPLIT` (base, +150°, +210°) · `MONO` (one hue, lightness and chroma vary). `ANY` gives the four thumbnails four different rules (each tagged `R-1 · MONO` …); a chosen rule gives four takes on it. Changing it rolls again. UI state, not an undo step. (The old `Harmony [ANY]` button is gone.) |
| `V` / `Vary [V]` button    | Opens a strip of four thumbnails over the foot of the stage: variations over the same nodes, gentle to bold. Three checkbox chips under the strip head choose what changes, any mix (at least one stays on, remembered in `localStorage` `gh.vary.v1`, default COMPOSITION only; toggling rolls again): COMPOSITION (position, reach, softness, rotation, opacity, sometimes a mirrored layout), COLOURS (hue turn, colour reshuffle between nodes, light / dark swing, per-node OKLCH jitter), EFFECTS (active FX amounts and options move, sometimes one effect comes on or goes off). Adopting one is a single `VARY` undo step, FX included; locked nodes untouched), rendered with the offscreen exporter (FX included). Click one or press `1`–`4` to adopt it (one undo step `VARY`); `V` again rolls a new set; `Esc`, a click elsewhere, or any edit closes it |
| `L` (selected / focused node), `STATE` row `LOCK [L]`, node menu | Lock: drags (core, gauges, ring, body), wheel, pinch, nudge keys, radius / soft / opac / rot / shape steppers, the colour page and hex field, Random, Vary and Extract all leave the node alone. It stays selectable and deletable, shows a small padlock on its reticle and `· LOCK` in the coordinate tag. Undo steps `LOCK N-xx` / `UNLOCK N-xx`. Stored in CS-06 (optional `lock` field) |
| `H`, `STATE` row `HIDE [H]`, node menu | Hide: the node is skipped by the field render (live and export), the reticle stays, ghosted (dashed brackets, hollow core), still selectable. The last visible node cannot be hidden. Undo steps `HIDE N-xx` / `SHOW N-xx`. Stored in CS-06 (optional `hide` field) |
| `⇧H`, `STATE` row `SOLO [⇧H]`, node menu | Solo the selected node: hides every other node; again (or un-solo from the menu) restores what was hidden before. Undo steps `SOLO` / `UNSOLO N-xx` |
| `PICK IMAGE [↥]` (FROM IMAGE section) or drop an image file on the stage | Palette extract: the image is downsampled to ≤ 96 px on a 2D canvas and clustered with k-means in OKLab (k = number of unlocked nodes, fixed seed, so one image always gives one palette). Colours go dark → light, lightest to the node highest on the stage; one undo step `EXTRACT`, ~600 ms tween. The image is decoded locally and never leaves the browser |
| `Esc`                      | Deselect                                                    |
| Double-click empty field   | Add a node there (colour = field under the point)           |
| Double-tap (touch)         | Same, two taps within 380 ms and 36 px (mouse: 320 ms / 24 px)  |
| `Add node` button          | Adds a node at the emptiest spot (max 16)                   |
| `Delete` / `Backspace`     | Remove selected node (min 2)                                |
| `Remove node` button       | Same                                                        |
| Tap, then hold a selected core (touch, 550 ms) | Opens the node menu beside it (SIGNAL progress arc on the armed hold only, moving > 6 px cancels). Removing on touch = tap → hold → `DELETE`. Holding an unselected node does nothing |
| Two-finger pinch (touch, node selected) | Scales that node's reach from where the pinch started; one `RADIUS` undo step. A second finger cancels any one-finger drag / hold / stroke |
| `D` / `DRAW [D]` button    | Draw mode (crosshair everywhere, nodes not hit-tested) and the **DRAW tray** over the foot of the stage (the RANDOM / VARY strip's plate). Left of its rule, the tools (`1`–`6`): PENCIL (freehand, simplified to ≤ 64 pts on release), LINE (`⇧` snaps to 45°), RECT / ELLIPSE / TRIANGLE (drag the box; `⇧` square / circle / even, `⌥` from the centre) and STAR (drag out from the centre, round to turn it, `⇧` snaps to 15°; `↑ ↓` points 3–12, `← →` spike depth, live while dragging; spike 0 = a regular polygon). Right of it, the look of the next shape: `OUTLINE` / `FILL` (closed shapes only), `WEIGHT` (the stroke's reach; hovering or dragging the slider shows a true-size preview of it above, scaled with a `1:n` tag when it would not fit) and, for the star, `POINTS` / `SPIKE`. Tool and settings are remembered (`localStorage` `gh.draw.v1`). Every shape is a stroke node; one per activation, then it is selected and draw mode ends. `Esc` or the tray's `×` exits. Touch: the `DRAW` toggle in the toolbar |
| DRAW tray with a drawn stroke selected | The tray stays up (head `N-xx // SHAPE · 04 PTS // EDITING THIS SHAPE`) and its `WEIGHT` and `OUTLINE` / `FILL` edit that stroke (undo steps `WEIGHT N-xx`, `FILL N-xx` / `OUTLINE N-xx`; one step per slider drag). A tool button starts drawing again. `×` hides the tray for that stroke until something else is selected. The tray jumps to the head of the stage whenever the stroke it is about runs under its spot at the foot |
| Selected stroke's anchors (squares) and edge `+` marks | Point editing (strokes with ≤ 32 anchors; shapes keep theirs: 4 for a rect, 3 for a triangle, 8 smooth ones for an ellipse). Drag a square to move that point; press a `+` to insert a point on that edge and drag it straight away; `⌥`-click or double-click a square, or press it and `Delete` / `Backspace`, to remove it (loops keep ≥ 3, lines ≥ 2). One undo step each (`POINT N-xx`, `DELETE POINT N-xx`); the core re-centres on the anchors afterwards. Ellipses stay a smooth curve through their anchors, other shapes keep sharp corners |
| Drag a stroke / shape body | Hover shows an open hand; dragging anywhere on a stroke (or inside an ellipse / box / capsule core) moves the whole node. One undo step `MOVE N-xx` |
| `SHAPE` row                | Circle / ellipse / box / capsule for the selected node (undo step `SHAPE N-xx`). Disabled for strokes, which show `STROKE · nn PTS` (open), `SHAPE · nn PTS` (closed outline) or `FILL · nn PTS` |
| `ROT` `[−]` `[+]`, `,` `.` | Rotate ellipse / box / capsule 15° (`Shift` = 45°); bursts coalesce into one undo step |
| Colour swatch / HEX field  | Recolour the selected node (OKLab tween); Enter/blur commit, Esc reverts |
| Palette strip chip         | Select that node                                            |
| `SAVE [↧]` (SAVED SETS header) | Store the field in the **active** library slot, else the first empty one (`LIBRARY FULL` if none: use a card's own `[↧]`). Saves nodes, shapes, strokes, FX; the card gets a small thumbnail of the field. Storage refusal (quota, private mode) is reported and the slot lives for the session |
| `CLEAR [×]` (SAVED SETS header, twice in 3 s) | Delete the saved set of the active slot (the header button only shows while a filled slot is active); the card goes back to dashed / empty (Esc cancels) |
| Library cards CS-06 … CS-13 | Eight slots under the five factory sets, a 4-up grid of thumbnails. Click a card = load that set (undo step `PRESET CS-0x`; an empty card says so). Each card has its own `[↧]` (save the current field into it, overwrites) and `[×]` (clear, press twice within 3 s, shown only while filled). A set saved before thumbnails existed (or migrated from v5) shows its colour chips until it is saved again |
| `U` / `Share [U]`          | Copy a link to the clipboard that restores this exact document (nodes with shape / rot / pts / soft / opac, colours, FX, wallpaper target); status `LINK COPIED`. Opening such a link (or pasting it while the app is open) loads it as one undo step `LINK` (`UNDO` goes back) and strips the hash from the address bar; a malformed one is ignored with `SHARE LINK NOT RECOGNISED — IGNORED`. Hash format below |
| `C` / `Copy [C]`           | Copy the field as a PNG to the clipboard: the quick-export render (2048 px long side, FX included, no handles). Needs the async clipboard API with `ClipboardItem` (HTTPS / localhost); otherwise a status line says so and Export still works |
| `X` / `Code [X]`           | Opens the CODE panel (modal; `Esc`, `CLOSE [×]` or a click on the backdrop closes, focus is held inside, `←` `→` switch tabs). Tabs **GLSL** (the shipped vertex + fragment shaders verbatim, plus the uniform values that reproduce this field at the wallpaper size; FX are a separate pass and not included), **JSON** (the document, same schema as saved sets and share links), **CSS** (stacked `radial-gradient`s over a base colour) and **SVG** (radial-gradient ellipses + a blurred stroke group). CSS and SVG are **approximations** and say so in the panel: no OKLab blend, warp, softness curves, FX; rotation is dropped in CSS. Each tab has its own `COPY [⧉]` |
| `P` / `PREVIEW [P]` button (above the artboard's top-right corner) | Bare wallpaper: fades out (≈ 200 ms, instant under reduced motion) every node, ring, gauge, chip, stroke overlay, the FX dial, the rulers, corner marks and foot readouts; the gradient keeps rendering with its FX at the wallpaper aspect. The stage is inert while on (no drags, dial, wheel, double-click add, no edit keys). `Esc`, `P` or the button exits. Not persisted |
| `\` / `PANEL [»]` button (top bar, far right) | Collapse / expand the right spec panel (≥ 960 px). The artboard grows into the freed width and re-fits; all other shortcuts keep working. Remembered in `localStorage` (`gh.panel.v1`). Hidden on the stacked mobile layout |
| `M` / `DARK [◐]` button (top bar) | Light / dark theme. Defaults to the OS `prefers-color-scheme`; your choice is remembered in `localStorage` (`gh.theme.v1`) and applied before first paint. The lime accent, black bars, node overlays and the gradient stay as they are. Crossfades in ~150 ms (instant under reduced motion). Also available on the stacked mobile layout |
| `G` / `SNAP [G]` button (toolbar) | Snap on / off. While a node drag runs with snapping effective: x and y round to the rulers' graduation (20 steps a side, so a faint grid of the same ticks shows, 5-step majors stronger) and align to other nodes' x / y within 6 px (a thin SIGNAL guide line shows the alignment; alignment wins over the grid). Hold `⌘/Ctrl` during a drag to invert snapping for that drag. Strokes snap by their anchor (centroid). Keyboard nudges never snap. The grid is artboard furniture: hidden in preview, never in an export. Remembered in `localStorage` `gh.tools.v1` |
| `Y` / `MIRROR [Y]` button (toolbar) | Cycles symmetry OFF → X (mirror across the vertical centre axis) → Y (horizontal) → XY (4-fold) → OFF; the button prints the mode and a dashed axis shows on the artboard (not in preview / export). Turning it on pairs existing nodes by nearest mirrored position (within 10 % of the short side; strokes never pair; the pairing is rebuilt on every mode change, preset or reset). Dragging or nudging a node moves its partner(s) to the exact mirrored position (one undo step `MOVE N-xx` for the lot); a node with no partner moves alone. Double-click add also drops the partner node(s) (fewer if the 16-node cap bites; one `ADD NODE` step). Only **position** is mirrored: colour, radius, softness, shape and delete stay per node. Not persisted |
| `I` / `PICK [I]` (panel COLOUR row) | Eyedropper, needs a selected node. Armed: crosshair over the whole stage and a loupe chip (swatch + hex) by the pointer; the next click samples the field colour under it (nodes only, FX not included, the same sampling as double-click add) and applies it to the selected node (one undo step `PICK N-xx`). `Esc`, or the button again, cancels. `⇧I` / `⇧`-click: the browser's own screen-wide picker where `window.EyeDropper` exists (Chromium), else the same as `I` |
| `⌘/Ctrl+Z`, `⇧⌘/Ctrl+Z`    | Undo / redo (50 steps): add, remove, colour, drags, presets |
| Colour set rows            | Switch preset; colours tween in OKLab over ~600 ms          |
| FX knob (GRAIN · DITHER · CHROMA · SCAN · VIG · HALFTONE · PIXEL · ASCII · MAP · GLOW · GRADE · WARP) drag | Up / right = more, ≈ 160 px for the full range. One undo step per drag |
| FX knob scroll             | ~1 step per 12 px, wheel up = more; a 700 ms burst is one undo step. Never scrolls the page while over a knob |
| FX knob focused            | `← ↓` / `→ ↑` ±1 (`Shift` ×10), `PageUp` / `PageDown` ±10, `Home` OFF, `End` max. Global shortcuts are suspended while a knob has focus |
| FX knob double-click / double-tap | Toggle OFF ↔ last non-zero value (first time: half way round the knob — 50, dither 9 LV) |
| FX checkbox (left of each effect) | Same toggle as the double-click, one undo step; reflects the knob live (0 = unchecked). `Space` when focused |
| `FINE`/`COARSE`, `BAYER`/`BLUE`, `H`/`V`/`B` | Grain size, dither pattern and scanline direction (horizontal, vertical, both = grid); one undo step each, clickable while the effect is off |
| `FINE`/`COARSE` (HALFTONE, ASCII), `PST`/`DUO`/`TRI` (MAP), `P`/`W`/`C`/`F` (GRADE), `LO`/`MID`/`HI` (WARP) | Halftone / ASCII cell size; MAP mode (posterize, duotone, tritone from the darkest / middle / lightest node colour); GRADE look (punch = contrast + saturation, warm, cool, fade = lifted blacks); WARP noise scale (broad, house, tight). One undo step each, clickable while the effect is off |
| HALFTONE · PIXEL · ASCII · MAP · GLOW · GRADE · WARP knobs | HALFTONE: 45° dot screen, dot area follows luma, full-colour dots on a near-black sheet. PIXEL: mosaic block 2 → 40 preview px. ASCII: nine procedural mono glyphs (`. : - = + * # @` densities) in 1 : 1.7 cells, in the cell's colour. MAP: POST = 12 → 2 levels per channel as you turn up; DUO / TRI = blend (0–100) into a gradient map through the node colours. GLOW: bloom on the bright areas, radius grows with the amount. GRADE: amount of the chosen look. WARP: the field's domain-warp strength; **OFF reads `STD` and is the house look** (today's constant), knob 50 is the same strength, 1 is flat, 100 doubles it, so existing saves look identical |
| `ALL OFF [×]`              | Switch every effect off (undo step `FX OFF`); WARP returns to `STD` |
| Click / tap on empty board (also `⌥`+scroll, `F`, `FX DIAL [F]` corner button above the artboard's top-left) | FX dial opens centred at the cursor (after 240 ms, so a double-click still adds a node and cancels it), clamped inside the stage. One concentric 270° ring per enabled effect, all on one dial (GRAIN · DITHER · CHROMA · SCAN · VIG · HALFTONE · PIXEL · ASCII · MAP · GLOW · GRADE · WARP, innermost first; past five rings the spacing tightens to fit) inside a dashed bezel with ticks and 000/090/180/270 bearings, a corner-bracket reticle at the click point and a black mono tag per ring (`GRAIN // 50`). Clicking anywhere off a ring while it is open (empty board, a node, the dial's centre or gap) closes it and the click acts normally (deselect, node grab); the next empty click opens it again. With a node selected (or a menu / stroke active) the first click only deselects; the next one opens the dial. Not opened in DRAW mode or after a drag. `F` / the button use the cursor when it is over the stage, else the stage centre. Over a node `⌥`+scroll still tunes SOFT |
| FX dial ring: hover / drag / scroll | Hover thickens that ring and dims the rest. Drag round it like a knob (one undo step); scroll steps it (~1 per 12 px, bursts coalesce), with or without `⌥`, and nodes do not resize while the dial is open. Only effects that are on have a ring: taking one to 0 (drag, scroll or keys) turns it off and its ring goes on release (scroll: after the burst; keys: when focus leaves it). Panel changes, checkmarks and unchecks update the dial live |
| FX dial `+` chip (one spacing under the outermost label) | Opens the ADD menu (the node menu's plate, `[data-testid="fx-menu"]`, items `[data-fx-add="…"]`) listing the effects that are off; pressing one turns it on (same as its panel checkbox, one undo step) and its ring appears. `↑ ↓` move, `Enter` adds, `Esc` / a press elsewhere closes it (the dial stays). Hidden when all twelve are on. Focused ring: `+` / `=` opens it |
| FX dial `×` square (FLARE, right of each ring's label) | Turns that effect off (one undo step) and removes its ring. Focused ring: `Delete` / `Backspace` |
| FX dial focus | Rings are sliders: `Tab` between them, `← ↓` / `→ ↑` ±1, `⇧` ×10, `PageUp/Down` ±10, `Home` OFF, `End` max |
| FX dial dismiss            | `Esc`, `F`, a click off the rings, or the pointer parked well away from it for 1.5 s. Clicking the panel does not close it |
| WALLPAPER targets          | PHONE 1290×2796 · LAPTOP 2560×1600 · 4K 3840×2160 · ULTRA 5120×2160 · SQUARE 2048×2048 · CUSTOM (W × H inputs, 16–16384 px per side, clamped on Enter/blur, ⇄ swaps; first use starts from the selected preset). Picking one reshapes the artboard to that aspect (fit and centred), so the stage is what exports. Not an undo step, but remembered |
| `Export [↓]` button, `E`   | The single export button (toolbar, id `export`): renders the field + FX at the target size (`GH-CS01-4K-3840x2160-2041.png`). If the GPU cannot allocate it the button says `Too large`, the status line gives the real limit, and nothing downloads |
| `⇧`-click Export, `⇧E`     | Quick copy: downloads the field (FX included, no handles) at 2048 px long side (`ui.ts` `exportPng`) |
| Reset                      | Restores the current preset's positions and radii           |

### Share link format

`#g1=<base64url(JSON)>` (plain) or `#g1z=<base64url(deflate-raw(JSON))>` (used when `CompressionStream` exists and it is smaller; a typical nine-node field is ~370 characters). The JSON is `serialiseDoc` from `src/custom.ts`: `{"v":2,"nodes":[…],"fx":{…},"wp":"4k","cs":{"w":…,"h":…}}`, the same node schema as the CS slots, validated on read by `parseDoc` / `parseFx` (bad nodes are skipped, numbers clamped, a document with fewer than 2 valid nodes is rejected; input is capped at 200 k characters / 400 k decoded). `g1` is the version prefix: a new schema gets `g2`.

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

FX are an optional post pass. With everything off the field draws straight to the canvas (no framebuffer). With any FX on, the field renders into a texture and one fullscreen shader applies pixel → chromatic aberration → glow → grade → map → halftone → ASCII → vignette → scanlines → grain → dither. WARP is the exception: it lives in the field shader (`u_warp`, `u_wscale`) and alone needs no post pass. Grain is **seeded and static** (no time term), so an export matches the preview. Pattern cells are authored in preview CSS px and scaled by `fxUnit` (buffer px per preview px), so a 4K export looks like the preview at viewing size. Wallpaper targets reframe by *cover-fit, keep node positions relative*: nodes keep their `(x·W, y·H)` positions and every size (radii, stroke offsets, warp) uses the area-matched unit `u = min · √(W·H / (stageW·stageH))`. FX and the wallpaper target persist in `localStorage` `gh.fx.v1`; CS-06 stores its FX too (optional `fx` field, still `v:2`).

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

- v6 Output: `[data-action="share|copy-png|code-export"]` (toolbar, ids `share`, `copy-png`, `code-export`; `.is-done` for ~1.5 s after a success);
  the CODE panel is `dialog.code-dlg` (`open` attribute while shown) with `.code-tab[data-code-tab="glsl|json|css|svg"]` (`aria-selected`),
  `.code-note` (`.is-approx` on CSS / SVG), `.code-view code` (the text), `[data-action="code-copy|code-close"]`. Library: `#slots`, cards
  `.slot[data-slot="0–7"]` with `[data-preset="cs06"…"cs13"]` (`role=radio`, `.is-empty`, `.is-active`; `[data-preset="cs06"]` is the first slot as before),
  per-card `[data-action="slot-save"][data-slot]` and `[data-action="slot-clear"][data-slot]` (`data-armed`); the header `save-custom` / `clear-custom`
  act on the active slot. Storage: `gh.slots.v1` = `{v:1, slots:[null | {doc:{v:2,nodes,fx}, savedAt, thumb?}] × 8}`; the v5 single slot `gh.custom.v1`
  is read once into slot 0 when `gh.slots.v1` does not exist and is never written or removed (a v5 build still sees its own CS-06).
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
  `[data-action="draw-mode|rot-minus|rot-plus"]` (one `draw-mode` button, in the toolbar); shape picker `.shape-btn[role=radio][data-shape]`. Note `[data-shape]` also matches the picker buttons,
  so scope node queries as `[data-node][data-shape=…]`. CS-06 storage is `{v:2,…}` (v1 still loads).
- Round 4b: `[data-node]` also carries `data-soft` (0–100, the target value) and `data-layer` (1-based, back = 1);
  `data-hover-state` / `data-drag` gain `soft`; panel `#ns-soft`, `#ns-layer` (`LYR 03/07`), `#soft-bar` (10 `<i>`,
  `.is-on` = filled) and `[data-action="soft-minus|soft-plus"]`. The node menu is `[data-testid="node-menu"]`
  (always in the DOM, `hidden` while closed; `role=menu`, items `role=menuitem`) with items
  `[data-action="layer-front|layer-up|layer-down|layer-back|menu-delete"]`. CS-06 nodes carry `soft` only when it
  differs from the shape default (0.5, strokes 0.75). The radius keys moved from `[`/`]` to `-`/`=`.
- v4: `html[data-fx]` / `body[data-fx]` = active effects in fixed order (`grain,dither,chroma,scan,vig,halftone,pixel,ascii,map,glow,grade,warp`, empty when none; WARP counts only when above 0);
  `[data-fx-knob="grain|dither|chroma|scan|vig|halftone|pixel|ascii|map|glow|grade|warp"]` (`role=slider`, `aria-valuenow` = raw state: 0–100, dither 0 or 2–16);
  `[data-fx-opt="grain-fine|grain-coarse|dither-bayer|dither-blue|scan-h|scan-v|scan-b|halftone-fine|halftone-coarse|ascii-fine|ascii-coarse|map-post|map-duo|map-tri|grade-punch|grade-warm|grade-cool|grade-fade|warp-lo|warp-mid|warp-hi"]` (`aria-checked`); `[data-fx-check="grain|dither|chroma|scan|vig|halftone|pixel|ascii|map|glow|grade|warp"]` (native checkbox, `aria-label` “Grain on” …); `[data-action="fx-off"]`;
  `[data-fx-ring="…"]` (dial ring, one per enabled effect); stored FX gained `halftone, halftoneSize, pixel, ascii, asciiSize, map, mapMode, glow, grade, gradeMode, warp, warpScale` (missing = default);
  `#fx-hint` (`— ALL OFF` / `— 2 ON`); `[data-wp="phone|laptop|4k|ultra|square"]` (`role=radio`, `aria-checked`);
  `[data-action="export"]` (the one export button; `export-wallpaper` is gone); `#wp-dims`; `localStorage` `gh.fx.v1` = `{v:1, fx, wp, cs:{w,h}}` (`cs` optional on read).
- v6 Tools: `html[data-snap="on|off"]`, `html[data-mirror="off|x|y|xy"]`; `[data-action="snap|mirror|eyedropper"]` (`aria-pressed`; the eyedropper button is disabled without a selected node and pressed while armed); `.stage.is-eyedrop` while armed, loupe `.chip-loupe`; artboard furniture group `.tools-layer` (`.grid-on` while a snapping drag runs, `.tl-guide` / `.tl-axis` paths). `localStorage` `gh.tools.v1` = `{v:1, snap}`.

- v6: `[data-node]` also carries `data-lock` and `data-hide` (`true|false`, set by the first frame); `.node.is-locked` / `.is-hidden`.
  `[data-vary-axis="comp|color|fx"]` (`aria-pressed`) in the VARY strip; `[data-action="randomize|vary|harmony|extract|lock|hide|solo"]` (`harmony` carries `data-harmony="any|analog|compl|triad|split|mono"`; `vary` has `aria-pressed`; `lock|hide|solo` are the panel `STATE` row, `aria-pressed`);
  node menu items `[data-action="menu-lock|menu-hide|menu-solo"]`; VARY strip `[data-testid="vary"]` (`hidden` while closed) with
  `[data-action="vary-pick"][data-vary="0–3"]`; file input `#extract-file`; `.stage.is-drop` while a file is dragged over; presets `[data-preset="cs21"…"cs25"]`.
  CS-06 nodes carry `lock` / `hide` only when true. New built-in sets CS-21 … CS-25 (HULL BREACH, AFTERBURN, ICE CORE, RELAY GHOST, SALT FLAT); CS-06 … CS-13 are left free for the save library.

- Footer and rail stats: `[data-stat="visits|exports"]` show this browser's counts (`localStorage` `gh.stats.v1`): VISITS = page loads, EXPORTS = PNG downloads (Export and the quick copy). Nothing is sent anywhere.

- Draw tools: `[data-testid="draw-tray"]` (`hidden` unless drawing or a stroke is selected; `.is-top` while flipped to the
  stage head, `.is-editing` while it edits the selected stroke), tools `.dt-tool[data-draw-kind="pencil|line|rect|ellipse|tri|star"]`
  (`role=radio`, `aria-checked`), style `[data-draw-fill="false|true"]`, `.dt-weight input[type=range]` with `.dt-preview`, star
  `.dt-star` fields, close `[data-action="draw-tray-close"]`. Strokes in documents may carry `closed`, `fill` and `smooth`
  (`true` only; `fill` needs `closed`); a filled loop is shader shape 5. Point editing: `.vtx-layer` (`.vtx-sq` anchors,
  `.vtx-mid` edge marks, `.is-hot` on the hovered / active one); `data-hover-state` gains `vtx|mid`, `data-drag` gains `vtx`.
- Panel sections: `.spec-section[data-sec="presets|saved|image|node|fx|wallpaper"]` (`.is-collapsed`), header `.sec-head`,
  toggle `.sec-toggle` (`aria-expanded`, `aria-controls` = `#sec-<id>`), body `.sec-body`.
- Top bar HUD: `.hud`, `#hud-cursor` (`.is-on` while the pointer is over the stage), `#hud-meter` (16 `<i>`, `.is-on` /
  `.is-sel`), `#hud-count`. The old `#state-readout` / `#state-glyph` and the `SPEC [↓]` link are gone.

- REV plate (spec panel head, `.rev`, `[data-build="version|sha|date|env"]`): `REV 06.2`, `BUILD <sha> // YY.MM.DD`, `LIVE` / `DEV`. Stamped at build time by `vite.config.ts` (`package.json` version; commit from `VERCEL_GIT_COMMIT_SHA` on Vercel, else `git rev-parse`), so every deploy shows its own commit and date. Bump `version` in `package.json` for a new REV number.

## Credits

Handle mechanic after Isaiah (@eyexayuh)'s mesh-gradient node controls.
Built for Jędrzej Mejzner / NEWFRAME.
