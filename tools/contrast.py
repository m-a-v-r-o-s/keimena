import math

def srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def hex_to_oklch(h):
    r, g, b = (srgb_to_lin(x) for x in hex_to_rgb(h))
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = (math.copysign(abs(v) ** (1/3), v) for v in (l, m, s))
    L = 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_
    A = 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_
    B = 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
    C = math.hypot(A, B)
    H = math.degrees(math.atan2(B, A)) % 360
    return L*100, C, H

def rel_lum(h):
    r, g, b = (srgb_to_lin(x) for x in hex_to_rgb(h))
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

CANVAS = '#1B1714'

palette = {
    'ink-canvas':    CANVAS,
    'ink-raised':    '#241F1A',
    'ink-recessed':  '#131010',
    'paper-text':    '#F2EDE4',
    'paper-muted':   '#B3A99B',
    'paper-faint':   '#8A8073',
    'accent-oxblood':'#D9634A',
    'accent-deep':   '#8C3A2B',
}

print(f"{'token':<18}{'hex':<10}{'oklch':<30}{'contrast vs canvas':>18}")
print('-' * 78)
for name, hx in palette.items():
    L, C, H = hex_to_oklch(hx)
    ok = f"oklch({L:.1f}% {C:.3f} {H:.1f})"
    cr = contrast(hx, CANVAS)
    print(f"{name:<18}{hx:<10}{ok:<30}{cr:>17.2f}:1")

print()
print("WCAG AA gates (against ink-canvas #1B1714):")
for name in ['paper-text', 'paper-muted', 'paper-faint', 'accent-oxblood', 'accent-deep']:
    cr = contrast(palette[name], CANVAS)
    body = 'PASS' if cr >= 4.5 else 'FAIL'
    large = 'PASS' if cr >= 3.0 else 'FAIL'
    print(f"  {name:<16} {cr:5.2f}:1   body(4.5) {body:<5} large/UI(3.0) {large}")

def oklch_to_hex(L, C, H):
    """Inverse of hex_to_oklch, for checking mixed grounds."""
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    L = L / 100.0
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    def enc(c):
        c = max(0.0, min(1.0, c))
        c = 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4)) - 0.055
        return round(c * 255)
    return '#%02X%02X%02X' % (enc(r), enc(g), enc(bb))


import json
import sys

# ---- Per-book colour pair (DECISIONS.md D10) --------------------------------
# Every book carries TWO colours. `accent` is the book's own colour -- its cover,
# its spine, its object. `ground` is the BOOK PAGE ground, derived from the accent
# so the pair is guaranteed related and guaranteed gated. The shelf ground is
# constant ink and is not checked here: it does not change per book.
#
# The 26% tint that v1 used on the shelf is retired. It solved a problem that no
# longer exists -- with real 3D covers nothing needs a tinted ground to stay
# visible -- and the live reference does not do it (D10).

GROUND_L = 24.0     # OKLCH lightness the derived ground is pinned to
GROUND_C = 0.45     # chroma multiplier off the accent
MIN_ACCENT_L = 38.0 # accents below this vanish against their own ground

# The reading ground: the room a book gets when it is opened.
#
# Complementary rather than same-hue -- the opposite side of the colour wheel is
# what makes a cover sit forward off its background instead of sinking into it.
# Held dark and low-chroma on purpose: a full-strength complement is a poster,
# and the register here is a catalogue. Both floors below still bind.
#
# LIGHTNESS is confined to two bands, not swept freely 19-64 as v1 did. This is
# not a preference -- it is what press.stripe.com's own 17-book palette proves.
# Its grounds are bimodal in OKLCH lightness (ten below 38, five above 77), and
# the only two that land in the middle (L 51, L 65) are the only two whose text
# misses WCAG AA -- 3.42:1 and 4.09:1. At mid lightness neither a lightened nor
# a darkened text can get far enough away to clear 4.5:1, let alone the 7:1 this
# file now asks of the primary text tier. v1's READ_L_MAX = 64 swept straight
# through that dead zone and, independently, landed two of our own books there
# for the identical reason: both have near-black covers, and the old sweep kept
# lightening the ground until the cover separated, with no ceiling on where
# lightness stopped being usable for text.
READ_L_MIN = 19.0        # darkest a dark-band ground goes, for a light cover
READ_L_DARK_MAX = 38.0   # dark band ceiling -- try this band first
READ_L_LIGHT_MIN = 72.0  # light band floor -- fallback when the dark band can't
READ_L_LIGHT_MAX = 91.0  # separate a very dark cover
READ_C = 0.055           # a tint of the complement, never the complement itself
READ_FLOOR = 1.7         # cover against its ground, with margin over D10's 1.5

# Per-book READING TEXT. Three tiers -- title/edition/buy, synopsis/eyebrow,
# and market-note/rule -- each gated to its own WCAG target, all three carrying
# the book's own accent hue rather than the global paper-text token. Hue is
# identity; lightness is legibility. press.stripe.com's palette makes the same
# split -- its ΔHue runs 0-175° with no pattern (two books even set text at the
# SAME hue as their ground) while its ΔLightness never drops below 32 points --
# which is the mechanism that lets text be "related to the book" and still
# always contrast well, the two halves of the brief that motivated this file.
TEXT_C_CAP = 0.095   # reference's own text colours average ~0.09 chroma; past
                      # this a book's text stops reading as a tint of the book
                      # and starts competing with the cover as a second accent.
TEXT_TARGET = 7.0     # AAA -- title, edition list, buy link
MUTED_TARGET = 4.5    # AA  -- synopsis, eyebrow
FAINT_TARGET = 3.0    # UI  -- market note, rules, borders


def derive_ground(accent_hex):
    """A book's page ground: same hue as its accent, calmer and much darker."""
    L, C, H = hex_to_oklch(accent_hex)
    return oklch_to_hex(GROUND_L, C * GROUND_C, H)


def derive_reading(accent_hex, cover_luma=None, override_hex=None):
    """The room a book gets when opened: a tint of a hue, lightened or
    darkened until the cover separates from it. Returns (hex, polarity).

    HUE comes from an existing manual override when the book has one -- the
    mud/collision fixes documented below, e.g. nychterino-deltio's teal --
    otherwise from the accent's literal complement. Either way only LIGHTNESS
    moves here: an override fixes a hue that reads badly at this recipe, not a
    lightness, and re-deriving the hue from scratch would silently undo that
    fix the next time this ran.

    LIGHTNESS answers to the cover, swept within the dark band first (it is
    where ten of the reference's seventeen grounds sit, and where our own
    palette already mostly lives) and only into the light band if no dark
    value separates a very dark cover. The old free sweep to L 64 is what put
    two books in the banned mid-lightness zone; this cannot, because that zone
    is never visited.
    """
    if override_hex is not None:
        _, _, hue = hex_to_oklch(override_hex)
    else:
        _, _, H = hex_to_oklch(accent_hex)
        hue = (H + 180.0) % 360.0

    if cover_luma is None:
        return oklch_to_hex(READ_L_MIN, READ_C, hue), 'dark'

    la = rel_lum(accent_hex)

    def clears(candidate):
        lg = rel_lum(candidate)
        # BOTH have to clear it. The cover is the largest surface, but the
        # spine and boards carry the accent and are just as visible in the
        # reading view -- a ground that hides either one has failed.
        r_cover = (max(lg, cover_luma) + 0.05) / (min(lg, cover_luma) + 0.05)
        r_accent = (max(lg, la) + 0.05) / (min(lg, la) + 0.05)
        return r_cover >= READ_FLOOR and r_accent >= 1.55

    step = READ_L_MIN
    while step <= READ_L_DARK_MAX:
        candidate = oklch_to_hex(step, READ_C, hue)
        if clears(candidate):
            return candidate, 'dark'
        step += 1.0

    step = READ_L_LIGHT_MIN
    while step <= READ_L_LIGHT_MAX:
        candidate = oklch_to_hex(step, READ_C, hue)
        if clears(candidate):
            return candidate, 'light'
        step += 1.0

    # Neither band separated the cover. Return the dark band's lightest value;
    # the gate below still checks object/reading and will fail loudly on it
    # rather than silently shipping a ground that hides the book.
    return oklch_to_hex(READ_L_DARK_MAX, READ_C, hue), 'dark'


def derive_text_tier(accent_hex, ground_hex, polarity, target):
    """A per-book reading-text colour for one contrast tier.

    Hue comes from the book's own accent -- the same hue its spine and cover
    already carry -- so the text reads as the book's colour, not a generic
    tint. Lightness is swept AWAY from the ground (up for a dark-band ground,
    down for a light-band one) until the tier's target ratio is met. Chroma is
    reduced only if the lightness ceiling/floor is reached first: identity is
    the thing given up last, not first, mirroring the reference's own text
    colours, which stay saturated rather than fading toward grey.
    """
    _, Ca, Ha = hex_to_oklch(accent_hex)
    Lg, _, _ = hex_to_oklch(ground_hex)
    step = 0.5 if polarity == 'dark' else -0.5
    limit = 100.0 if polarity == 'dark' else 0.0

    C = min(Ca, TEXT_C_CAP)
    while C >= -0.001:
        L = Lg
        while (step > 0 and L <= limit) or (step < 0 and L >= limit):
            candidate = oklch_to_hex(L, C, Ha)
            if contrast(candidate, ground_hex) >= target:
                return candidate
            L += step
        C -= 0.01
    return '#FFFFFF' if polarity == 'dark' else '#000000'


# Manual `reading` overrides live in content/books.json, for two reasons:
#
# 1. Mud. An accent whose exact complement lands in the yellow-green/olive
#    band reads as brown once darkened and desaturated to READ_C -- not a bug
#    in the maths, just a hue this recipe doesn't suit. The first pass at this
#    (hue ~111 for to-kinima-tis-aftoktonias, chosen only to clear the
#    COLLISION check below) turned out to still read as mud -- 111 is close
#    enough to the same olive band to have the same problem the exclusion
#    was meant to prevent, so its "safe" range needs to be wider than the
#    literal complement hues that started this.
#      nychterino-deltio            -> teal        (hue ~195)
#      i-techni-tou-tromou          -> crimson      (hue ~16)
#      istories-tis-allis-ochthis   -> plum          (hue ~316)
#      to-kinima-tis-aftoktonias    -> deep teal      (hue ~212)
#
# 2. Collisions. With 17 books all landing in the same dark, low-chroma
#    family, several exact complements clustered within a few degrees of
#    each other -- to-kinima-tis-aftoktonias and o-tse-aftoktonise were 1.2
#    degrees apart, o-fonos-einai-chrima and i-exegersi-ton-karyatidon 1.4,
#    functionally the same room. A greedy solve moved only the minimum
#    number of books needed to clear ~15-18 degrees from every same-lightness
#    neighbour (see the audit script in git history), leaving the rest of the
#    palette computing exactly as before:
#      i-exegersi-ton-karyatidon    -> hue ~44
#      istories-tou-kyriou-koiner   -> hue ~176
#      faust                        -> hue ~129
#      i-via-tis-apotychias         -> hue ~359
#
# Every override was swept to a hex with the same loop above and gated
# against the same floors as every computed value. `b.get('reading') or
# derive_reading(...)` below is what makes an override actually take --
# every other book still computes on its own.

# The held-book teaser: a sharp-edged card filled with a darkened mix of the
# book's OWN accent -- the same colour the spine already carries. The text
# used to be the book's literal `reading` colour, by an earlier request --
# not a contrast-swept tint, and measured contrast against the fill ran as
# low as 1.32:1 across the 17 books (nowhere near WCAG AA's 4.5:1). That
# was surfaced and accepted at the time, but it also meant the teaser and
# the reading panel could read as two different colours for the same book,
# since the panel's own text was never `reading` -- it is `muted` (below).
# The frontend now points the teaser's text at the SAME `muted` tier the
# panel uses, so the two always agree; `reading` itself is unchanged here
# and still what the room behind the panel is tinted with.
def mix_toward_black(hex_color, keep):
    """Reproduces CSS `color-mix(in oklab, hex_color keep%, black)` exactly:
    black is L=0/C=0 in OKLab, so mixing toward it is just scaling L and C.
    Computed here, not left to the browser, so the result can be gated."""
    L, C, H = hex_to_oklch(hex_color)
    return oklch_to_hex(L * keep, C * keep, H)


BOX_FILL_KEEP = 0.80  # how much of the raw accent survives in the card fill


data = json.load(open('content/books.json'))
TEXT = palette['paper-text']

print()
print("=" * 78)
print("PER-BOOK COLOURS -- accent (object), ground (shelf page), reading (opened)")
print(f"ground  = oklch(L {GROUND_L}%, C x {GROUND_C}, same hue)        [D10]")
print(f"reading = oklch(L {READ_L_MIN}-{READ_L_DARK_MAX} or {READ_L_LIGHT_MIN}-{READ_L_LIGHT_MAX}%, C {READ_C})  [complement/override hue]")
print("=" * 78)
print(f"{'book':<24}{'accent':<9}{'ground':<9}{'accent L':>9}{'text/gnd':>10}{'obj/gnd':>9}  verdict")
print('-' * 78)

failures = []
worst_text, worst_obj, worst_L = 99.0, 99.0, 999.0
worst_robj = 99.0
worst_texttier, worst_mutedtier, worst_fainttier = 99.0, 99.0, 99.0

for b in data['books']:
    acc = b['accent']
    ground = b.get('ground') or derive_ground(acc)
    L, _, _ = hex_to_oklch(acc)
    c_text = contrast(TEXT, ground)
    c_obj = contrast(acc, ground)

    # NOTE: global paper-text is no longer what renders in the reading view --
    # the three per-book tiers below are -- so it is not gated against `reading`
    # here. It stays gated against the SHELF ground (c_text, above), which it
    # still has to render on.
    reading, polarity = derive_reading(acc, b.get('cover_luma'), override_hex=b.get('reading'))
    c_robj = contrast(acc, reading)

    text_tier = derive_text_tier(acc, reading, polarity, TEXT_TARGET)
    muted_tier = derive_text_tier(acc, reading, polarity, MUTED_TARGET)
    faint_tier = derive_text_tier(acc, reading, polarity, FAINT_TARGET)
    c_texttier = contrast(text_tier, reading)
    c_mutedtier = contrast(muted_tier, reading)
    c_fainttier = contrast(faint_tier, reading)

    worst_text = min(worst_text, c_text)
    worst_obj = min(worst_obj, c_obj)
    worst_L = min(worst_L, L)
    worst_robj = min(worst_robj, c_robj)
    worst_texttier = min(worst_texttier, c_texttier)
    worst_mutedtier = min(worst_mutedtier, c_mutedtier)
    worst_fainttier = min(worst_fainttier, c_fainttier)

    bad = []
    if c_text < 4.5:
        bad.append('text/ground < 4.5')
    if c_obj < 1.5:
        bad.append('object/ground < 1.5')
    if L < MIN_ACCENT_L:
        bad.append(f'accent L {L:.1f}% < {MIN_ACCENT_L}%')
    if c_robj < 1.5:
        bad.append(f'object/reading {c_robj:.2f} < 1.5')
    if c_texttier < TEXT_TARGET:
        bad.append(f'text-tier/reading {c_texttier:.2f} < {TEXT_TARGET}')
    if c_mutedtier < MUTED_TARGET:
        bad.append(f'muted-tier/reading {c_mutedtier:.2f} < {MUTED_TARGET}')
    if c_fainttier < FAINT_TARGET:
        bad.append(f'faint-tier/reading {c_fainttier:.2f} < {FAINT_TARGET}')

    verdict = 'PASS' if not bad else 'FAIL'
    if bad:
        failures.append((b['id'], bad))
        print(f"{b['id'][:23]:<24}{acc:<9}{ground:<9}{L:>8.1f}%{c_text:>9.2f}:1{c_obj:>8.2f}:1  {verdict}")

if not failures:
    print("  (all books pass -- only failures are listed)")

print()
print(f"  lowest text-on-ground  : {worst_text:5.2f}:1   floor 4.5  (WCAG AA)")
print(f"  lowest object-on-ground: {worst_obj:5.2f}:1   floor 1.5  (visibility, not WCAG)")
print(f"  lowest accent lightness: {worst_L:5.1f}%    floor {MIN_ACCENT_L}%")
print(f"  lowest object-on-read  : {worst_robj:5.2f}:1   floor 1.5  (visibility)")
print(f"  lowest text-tier/read  : {worst_texttier:5.2f}:1   floor {TEXT_TARGET}   (AAA, title/edition/buy)")
print(f"  lowest muted-tier/read : {worst_mutedtier:5.2f}:1   floor {MUTED_TARGET}   (AA, synopsis/eyebrow)")
print(f"  lowest faint-tier/read : {worst_fainttier:5.2f}:1   floor {FAINT_TARGET}   (UI, note/rules)")
print(f"  books checked          : {len(data['books'])}")

if failures:
    print()
    print(f"GATE FAILED -- {len(failures)} book(s):")
    for bid, reasons in failures:
        print(f"  {bid}: {'; '.join(reasons)}")
    sys.exit(1)

print()
print("GATE PASSED")

# ---- Emit derived grounds ---------------------------------------------------
# The renderer needs each book's ground, and duplicating OKLCH maths in JS would
# let the two drift silently -- the gate would keep passing while the page shows
# something else. So the gate itself is the single source of truth: it writes
# what it just verified. content/grounds.json is generated, never hand-edited.
if '--emit' in sys.argv:
    out = {}
    for b in data['books']:
        acc = b['accent']
        reading, polarity = derive_reading(acc, b.get('cover_luma'), override_hex=b.get('reading'))
        out[b['id']] = {
            'ground': b.get('ground') or derive_ground(acc),
            'reading': reading,
            'teaserFill': mix_toward_black(acc, BOX_FILL_KEEP),
            'polarity': polarity,
            'text': derive_text_tier(acc, reading, polarity, TEXT_TARGET),
            'muted': derive_text_tier(acc, reading, polarity, MUTED_TARGET),
            'faint': derive_text_tier(acc, reading, polarity, FAINT_TARGET),
        }
    with open('content/grounds.json', 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f"emitted content/grounds.json ({len(out)} books)")
