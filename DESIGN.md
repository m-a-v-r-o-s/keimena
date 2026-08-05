# Design System: Πέτρος Μάρκαρης — Catalogue

Single source of truth for Stitch screen generation and for the coded build.
Greek is the primary language of this interface. Rules that mention Greek are not
localisation notes — they are typography requirements.

---

## 1. Visual Theme & Atmosphere

A warm ink room, lit like a vitrine. The catalogue is one continuous shelf: books are treated
as **physical objects with thickness and a spine**, not as product tiles. The page is quiet,
wide-margined and gallery-airy; the drama comes from scale contrast between a book's title and
the calm around it, never from ornament.

> **Palette corrected 2026-07-30 against the reference's actual CSS.** The planning session
> specified warm *paper* (light beige). The reference site's canvas is in fact `#201819` — a
> warm near-black — with white text and a **per-book colour takeover** driven by
> `--coverColor` / `--backgroundColor` custom properties. The beige came from a
> markdown-converted page fetch that dropped the stylesheets. We follow the verified source.
> Full evidence and the reasoning in DECISIONS.md D6.

The register is **Athens noir, not pulp noir** — literary, civic, a little austere. Think a
serious imprint's catalogue that happens to be about crime, not a crime-fiction site. Warmth
comes from the ink being brown-black rather than grey-black, and from paper-white type; severity
comes from the dark ground and the low-chroma book colours.

- **Density: 2 (Art Gallery Airy)** around the shelf; the shelf itself is dense by design —
  the backlist stacks contiguously, and the air lives at its edges (see §5).
- **Variance: 5 (Offset Asymmetric).** The stack is regular; variance comes from the upright
  breakouts interrupting it and from each book's own colour and cover.
- **Motion: 5 (Choreographed Physical).** Raised from 3 — books are now real 3D objects that
  answer to scroll and to the pointer. The restraint moves from *amount* of motion to its
  *source*: nothing moves unless the user moves it. See §6 and DECISIONS.md D7.

---

## 2. Color Palette & Roles

Warm ink ground, warm paper-white type. Never cool grey — every neutral is warm-shifted, and
never `#000000`. **All values live in `tokens.css` as OKLCH; nothing here is inlined in a
component.** Contrast figures below are measured, not estimated.

- **Ink Canvas** (`#1B1714`) — page ground, the shelf's dark
- **Ink Raised** (`#241F1A`) — book faces, quote blocks
- **Ink Recessed** (`#131010`) — shelf shadow, wells
- **Text** (`#F2EDE4`) — primary type · **15.27:1** ✓
- **Text Muted** (`#B3A99B`) — synopses, secondary prose · **7.69:1** ✓
- **Text Faint** (`#8A8073`) — years, publication details · **4.59:1** ✓
- **Accent Oxblood** (`#D9634A`) — **the system accent**: links, focus, the single primary CTA,
  the "out now" marker · **4.95:1** ✓
- **Rule** (`text @ 16%`) — 1px hairlines, shelf edges

> The deep oxblood `#8C3A2B` from the light-paper draft scores **2.34:1** on this canvas and is
> **banned as a foreground**. It survives as a *book accent* — i.e. as a background, with Text
> on top, where it scores 6.54:1. Foreground and background accents are not interchangeable.

### Per-book colour — two colours per book, and the takeover is a *book-page* mechanic

> **Corrected 2026-07-30 against the live reference — see DECISIONS.md D10.** An earlier read
> concluded the reference recolours the page per book everywhere, and v1 applied that to the
> shelf via a 26% tint. Measured in rendered pixels, the reference's **shelf ground is constant
> `#201819` at every scroll depth**; per-book colour lives on the book object alone. The full
> ground takeover happens on **book pages** only. **The 26% tint formula is retired.**

Every book carries **two** colours, as the reference does:

- **`accent`** — the book's own colour. Its cover, its spine, its object. Authored per book.
- **`ground`** — the book-page ground. Derived from `accent` in OKLCH: same hue,
  chroma × 0.45, **L 24%**. A per-book `ground` override is honoured where one is needed.

Deriving rather than hand-authoring 27 second hex values keeps the pair guaranteed-related and
guaranteed-gated. Two floors bind, both enforced by `tools/contrast.py`:

- **Text on ground ≥ 4.5:1** (WCAG AA).
- **Object against its ground ≥ 1.5:1** — a *visibility* floor, not a WCAG one, so a book never
  disappears into its own page.

The second floor still implies a **minimum accent lightness of about OKLCH L 38%**, and the
four accents lifted to it in v1 stay lifted. **Any new book accent must clear both floors**;
run `python3 tools/contrast.py` after adding one.

Bounded by four constraints:

1. A book's colour is a **ground or an object surface, never a foreground**. It never tints
   body text, navigation, or a control.
2. **The shelf ground is constant Ink Canvas.** It does not change per book, and it does not
   crossfade. Colour arrives with the object entering the frame, and leaves with it.
3. **The takeover is total on a book page** — ground becomes `ground`, the object stays
   `accent`, type stays Text. One book, one page, one colour pair.
4. On the **series page**, where many spines share a viewport, colour is **suppressed
   entirely** — spines render in Ink Raised and Text only. Twenty-seven colours at once is a
   swatch library, not a shelf.

All book accents are muted earth/ink tones (oxblood, olive, slate, ochre, bark). The Crisis
Trilogy's three sit in a deliberately tight red family so the set reads as one object.

**Banned colour behaviour:** no purple or neon anything, no gradient fills on type, no glow, no
cool grey drifting into the warm neutrals, no pure black, no oversaturated "crime red".

---

## 3. Typography Rules

**Greek script coverage is a hard gate.** Most display faces ship Latin-only; a face without
real Greek is disqualified here no matter how good it looks. This overrides the generic
"distinctive modern serif" list (Fraunces, Instrument Serif, Editorial New) — those are
Latin-only and are therefore **banned in this project**, not recommended.

All three faces below were **verified against the Google Fonts API on 2026-07-30** for Greek
coverage (`U+0370–03FF`) and available weights. All are OFL — no commercial licence, no trial
watermark, nothing to negotiate. Subsets confirmed present: `greek`, `greek-ext`, `latin`.

- **Display — `GFS Didot`.** A genuine Greek Didone from the Greek Font Society. High stroke
  contrast, editorial, native to the Greek typographic tradition rather than a Latin face with
  Greek bolted on. Book titles and section heads only. Delicate: never below 24px, always with
  optical tracking correction (§3.1).

  > **Verified constraint: GFS Didot has exactly one weight (400) and no italic.**
  > Never write `font-weight: 700` or `font-style: italic` against it — the browser will
  > synthesize them, and synthetic bold on a high-contrast Didone smears the hairline strokes
  > into mud. This is the single easiest way to wreck this design.
  >
  > Consequence: **display hierarchy is built from size, colour and tracking, never weight.**
  > That is correct for a Didone and matches classic Greek book typography, which is
  > single-weight by tradition. Where a heading genuinely needs weight contrast, it is not a
  > display heading — set it in Literata.

- **Text — `Literata`.** Variable (weights 200–900, true italic), warm, designed for long-form
  reading, with genuine Greek. Synopses, author prose, all body copy, praise quotes, and any
  element needing weight contrast. This is the workhorse; it carries everything Didot cannot.
- **Metadata — `JetBrains Mono`.** Verified Greek coverage — rare in a mono and the reason it
  wins here. Years, series numbers, ISBNs, publication details. Never for prose.

The EN locale needs no separate display face: GFS Didot's `latin` subset is present and
verified, so one display face serves both locales.

**Banned:** Inter. System serifs (Times New Roman, Georgia, Garamond, Palatino). Any face
without verified Greek coverage. Latin-only display faces used on Greek text.

### 3.1 Greek typographic rules — non-negotiable

- **Never apply `text-transform: uppercase` to Greek text.** Greek drops the tonos in
  all-caps (Άμυνα → ΑΜΥΝΑ), and CSS uppercasing is inconsistent about it across browsers and
  depends on `lang="el"` being correctly set. Set capitals in the source string or don't use
  them. If a design calls for an all-caps eyebrow, use letter-spaced small caps in Latin
  metadata only, or restyle the Greek at its natural case.
- **Greek quotation marks are guillemets: «…»**, with typographic quotes inside. Never use
  straight quotes or English curly quotes in Greek copy. Book titles in running Greek prose
  take guillemets; in the UI, titles are set in the display face without quotes at all.
- **Greek runs 10–15% longer than English.** Every fixed-width element must be laid out
  against the Greek string, not the English one. Test the longest title —
  «Η τέχνη του τρόμου και άλλα διηγήματα» — in every component before shipping it.
- **Greek diacritics need vertical air.** Add ~0.06em extra line-height over the Latin default
  at display sizes so the tonos never collides with the descender above.
- **`lang` must be correct per element**, not just per page. A Greek title inside an English
  paragraph carries `lang="el"`. Screen readers switch voice on this; without it, Greek is
  read as mangled Latin.

### 3.2 Scale

Weight- and colour-driven hierarchy, not size escalation. Headline sizes via `clamp()`.

- Featured book title: `clamp(2.75rem, 6vw, 5.5rem)`, GFS Didot, tracking `-0.015em`
- Section head: `clamp(1.75rem, 3vw, 2.75rem)`, GFS Didot, tracking `-0.01em`
- Book title (shelf): `clamp(1.5rem, 2.4vw, 2.25rem)`, GFS Didot
- Body: `1.0625rem`, Literata, line-height `1.75`, max `65ch`
- Metadata: `0.8125rem`, JetBrains Mono, tracking `0.04em`, Ink Faint

High-contrast Didone display faces lose their thin strokes when tracked loosely at large
sizes and clot when tracked tight at small ones. Tracking is size-specific, always negative
at display sizes, never applied globally.

---

## 4. Component Stylings

- **Book object.** The core component, and now a **real 3D volume rendered in WebGL** (D7).
  Cover boards with slight overhang, a recessed pale **page block** on the fore-edge, and a
  spine — four distinct surfaces. The page block is what sells "object" over "card"; without
  it a book reads as a coloured box. Corner radius stays small — books are not app cards. A
  soft contact shadow tinted to Ink Recessed, never grey. On hover the volume eases ~2° toward
  the viewer and the contact shadow tightens. No lift-and-glow. **At rest it is motionless.**
  - *Two poses.* **Stacked** — lying flat, seen at a raking angle, cover foreshortened on top
    and the spine face carrying author left / title centre / publisher right. This is the
    backlist. **Upright** — standing at three-quarters, cover forward. This is the 2026
    featured title and the Crisis Trilogy. See §5 and D9.
  - *Draggable.* Pointer drag rotates the volume with velocity inertia; on release a spring
    returns it to the pose scroll owns. On a book page there is no spring-back — inspection is
    the point. Touch: horizontal drag rotates, **vertical always scrolls the page**.
  - *The DOM object underneath is the real one.* The canvas is `pointer-events: none` and
    `aria-hidden`; each book remains a focusable link/button in the server-rendered DOM, which
    is what screen readers, keyboards, crawlers and no-WebGL clients get. The canvas draws.
- **Book card, sparse state.** **Most titles currently have no synopsis and no praise
  (25 of 27).** A book with only a title, year and series number must still read as a
  finished object — the layout must not look broken or half-loaded. Achieve this with the
  book object doing the visual work and the metadata set confidently in mono. Never render an
  empty container, a "no description available" string, or a skeleton in a shipped page.
- **Quote block.** Praise is set large in Literata italic on Paper Raised, with the
  attribution in mono beneath, in Ink Faint. No quotation-mark glyph ornaments, no cards.
  Renders only when a verified quote exists.
- **Buttons.** Flat, Oxblood fill for the single primary action, ghost with a 1px Rule border
  otherwise. Tactile `translateY(-1px)` on active. No glow, ever. Minimum 44px tap target.
- **Buy links.** Outbound only, to Κείμενα and booksellers. Set as a restrained mono row of
  text links with the Rule hairline above — this is a catalogue, not a shop, and the links
  must not look like commerce chrome.
- **Navigation.** A thin persistent bar: wordmark left, Έργα / Σειρά / Ο συγγραφέας centre,
  EL·EN toggle right. Hairline bottom border only, no shadow, no blur-glass.
- **Language toggle.** `EL · EN` in mono, current locale in Ink, other in Ink Faint. It swaps
  content, not just labels, and it is content — treat it with the same weight as nav.

---

## 5. Layout Principles

- CSS Grid throughout. Max-width 1400px centred; the reading column inside it is 65ch.
- **The shelf is the homepage, and it is a continuous stack** (D9). The 26-title backlist
  renders as slabs lying flat with **zero gap between rows** — perspective alone separates
  them. Row height ~176px desktop / ~272px mobile; the book spans about half the viewport
  width on desktop and goes **full-bleed on mobile**, where the rake shallows so the cover art
  carries instead of the spine.
- **Upright breakouts interrupt the stack**: the 2026 featured title above it, the Crisis
  Trilogy within it. These get the full-height sections and the generous
  `clamp(6rem, 14vh, 11rem)` air; the stack itself gets none, by design. The contrast between
  stacked and upright is the shelf's structure — not decoration on top of it.
- **Shelf order is chronological by first publication**, newest first, with the 2026 featured
  title oversized at the top. Sorting on reissue years destroys the 30-year arc — see
  `content/README.md`.
- **The Crisis Trilogy renders as a boxed set**: three spines bracketed together with the
  epilogue set slightly apart. This is the structural centrepiece of the shelf and the clearest
  expression of "the series has internal architecture".
- Full-height sections use `min-h-[100dvh]`, never `h-screen`.
- No overlapping elements. No 3-equal-column card rows. No centred hero.
- **Mobile (<768px):** single column, no exceptions; no horizontal overflow anywhere. The stack
  goes full-bleed and the rake shallows — 3D **persists**, it does not flatten (the v1 rule
  that killed the tilt on mobile is superseded: a raking stack reads correctly at phone width
  where a tilted upright spine did not). Breakout section gaps scale via
  `clamp(3rem, 8vw, 6rem)`.

---

## 6. Motion & Interaction

**The restraint is about the *source* of motion, not its amount.** The baseline calls for
perpetual micro-loops — pulse, shimmer, float, typewriter. **All perpetual loops remain banned**
(D4, unchanged by D7). A literary catalogue with pulsing elements reads as a marketing page.
**Nothing on this site moves unless the user moves it** — by scrolling, or by dragging. A book
at rest is motionless, and the renderer enforces this literally: the canvas runs
`frameloop="demand"` and draws only while scroll, pointer or a spring is live.

**Scroll is never hijacked.** GSAP ScrollTrigger *reads* scroll and drives the scene from it;
nothing writes `scrollTop`, no smooth-scroll library, no section snapping. Verified as the
reference's own behaviour (native scroll, ratio 7.3× viewport, no overflow tricks).

Permitted motion, all GSAP + ScrollTrigger driving a `useFrame` lerp:

- **Stack transit.** As the stack scrolls, each slab's rake and its own colour resolve as it
  crosses the reading zone, and relax as it leaves. Continuous and scrubbed — this is the
  shelf's primary motion and it is entirely scroll-owned.
- **Breakout settle.** An upright volume — the featured title, the trilogy — settles as its
  section enters: short translate and opacity ease, 0.6s, custom ease-out, staggered ~80ms
  between title, metadata and synopsis. Once.
- **Featured book pin.** The 2026 title pins while its synopsis advances beside it, the volume
  presenting cover → spine → back across the pin. Still the site's **only** pinned section.
- **Trilogy fan.** Within its transit the three volumes fan a few degrees apart, the epilogue
  arriving last and offset. The shelf's centrepiece beat.
- **Drag.** Pointer-driven rotation with velocity inertia and a spring return (§4).
- **Hover.** ~2° toward the viewer, 200ms, spring-ish ease.

Banned: scroll-jacking, smooth-scroll hijacking, scroll-progress bars, "scroll to explore"
prompts and bouncing chevrons, counters that count up, text that types itself, anything
infinite, and — inside the lifted three.js scope (D7) — shader backgrounds, particle fields,
WebGL text, bloom and HDR environment bling.

**Performance and access:** animate only `transform` and `opacity` in the DOM layer. Budget
60fps desktop and no jank at DPR ≤ 1.5 mobile; mount only the meshes near the viewport; textures
≤ 1024px per face. Honour `prefers-reduced-motion: reduce` **as the animations are written, not
after** — under it, volumes render in their settled pose, and transit, parallax, pin and inertia
are all disabled. Drag still works: it is user-initiated, which is the whole test.

---

## 7. Anti-Patterns (Banned)

Everything in §2, §3.1 and §6 marked banned, plus:

- No emojis anywhere.
- No fabricated content of any kind — no invented synopses, praise quotes, blurbs, awards or
  bibliography entries. This site is about a living author and a real publisher. An empty
  field ships empty. (See `content/README.md`.)
- No real Κείμενα cover scans — copyrighted. Book faces are this system's own typographic
  covers, over our own generated art plates (D8).
- **No generated text on a cover, in any script.** Art plates are prompted abstract and
  textless; every glyph is composited from the real fonts afterwards. Diffusion Greek is
  gibberish, and gibberish Greek on this author's catalogue is the fastest way to wreck the
  whole register.
- No stock photography — and no *generated* imagery — of typewriters, magnifying glasses,
  fedoras, chalk outlines, rain-slick streets, or any other crime-fiction cliché. The prompt
  bans are the same list as the photography bans; a cliché is not laundered by being generated.
- No blood red, no bullet holes, no police tape, no "noir" film-grain overlay.
- No generic placeholder names, no fake round statistics.
- No AI copywriting: "Elevate", "Seamless", "Unleash", "Dive into", "Discover the world of".
  Copy is plain, declarative and Greek-first.
- No light/dark toggle. The ink canvas *is* the identity, not a mode — and the per-book colour
  takeover has no meaningful light inversion. A light alternate palette is parked in
  `tokens.css` for a direction change on review; it is not a user-facing setting.
- No newsletter modal, no cookie-consent theatre, no chat bubble.
