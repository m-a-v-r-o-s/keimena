#!/usr/bin/env python3
"""
Recut the social badges the user dropped in public/ (fb.png, ig.png, yt.png --
real brand assets, each platform's own colour) into this system's own two
tones, matching how tools/covers.mjs's imprintMark() treats the publisher's
own mark: source art in, recoloured art out, nothing hand-touched.

    python3 tools/social-marks.py

Each source's OWN shape is kept -- Facebook's circle, YouTube's rounded rect,
Instagram's frame -- there is no separate CSS chip drawn behind them:

  Facebook / YouTube ship as a FLAT COLOUR BODY (a circle, a rounded rect)
  with a WHITE glyph on top, both fully opaque -- alpha alone can't tell the
  two apart, only colour can. min(r, g, b) > 180 is "white enough" to be the
  glyph, repainted in --color-ink-recessed; everything else opaque is the
  body, repainted in --color-text. The badge ships whole, self-coloured.

  Instagram has no body to split out -- the ring/frame/dot is the only
  opaque content, on true alpha gaps -- so it is repainted as one colour,
  --color-text, matching the OTHER two badges' body tone rather than their
  glyph tone: on the dark footer it reads as a light mark same as the other
  two chips read as light chips, just without a chip to sit on, which is
  Instagram's own logo -- a frame, not a filled badge -- and not something
  this pipeline should invent a backing for.

Emits public/{fb,ig,yt}-mark.webp, each cropped to its own content box, so
the three keep their genuinely different aspect ratios (a circle, a wide
rounded rect, a square frame). components/Footer.jsx renders them as plain
<img>, sized by height with width left to the browser via the intrinsic
size below. If the source PNGs are swapped for higher-resolution versions,
rerun this and copy the new w/h it prints into the SOCIAL array in
Footer.jsx.
"""

from PIL import Image

INK = (19, 16, 16)      # --color-ink-recessed, #131010
CREAM = (242, 237, 228)  # --color-text, #F2EDE4


def recolor_badge(src, out):
    """Full badge, own shape kept: white glyph -> ink, colour body -> cream."""
    im = Image.open(src).convert('RGBA')
    px = im.load()
    w, h = im.size
    result = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    rpx = result.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            rpx[x, y] = (*(INK if min(r, g, b) > 180 else CREAM), a)
    cropped = result.crop(result.getbbox())
    cropped.save(out, lossless=True)
    print(f'{out}  {cropped.size[0]}x{cropped.size[1]}')


def recolor_frame(src, out, color):
    """No body to split out -- repaint the whole opaque shape one colour."""
    im = Image.open(src).convert('RGBA')
    px = im.load()
    w, h = im.size
    result = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    rpx = result.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            rpx[x, y] = (*color, a)
    cropped = result.crop(result.getbbox())
    cropped.save(out, lossless=True)
    print(f'{out}  {cropped.size[0]}x{cropped.size[1]}')


if __name__ == '__main__':
    recolor_badge('public/fb.png', 'public/fb-mark.webp')
    recolor_badge('public/yt.png', 'public/yt-mark.webp')
    recolor_frame('public/ig.png', 'public/ig-mark.webp', CREAM)
