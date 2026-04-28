"""Generate PWA icons + favicon for LINE 貼圖製造機.

Strategy: take one cell from a real Gemini grid (assets/sample-grid.jpg
by default — pre-set to the 「認真」 cell) → chroma-key out green →
present as a rounded portrait inside a soft LINE-green frame.

Falls back to a brand-only "LINE 3×3" icon if no source found.

Usage: python3 make_icons.py [path/to/grid.jpg]
Outputs:
  icon-192.png / icon-512.png     — full bleed
  icon-maskable.png               — 80% safe zone
  apple-touch-icon.png            — 180×180
  favicon.ico                     — 16/32/48
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).parent
DEFAULT_SOURCE = ROOT / "assets" / "sample-grid.jpg"

# Pick the cell index (0..8) that makes the best small-icon portrait.
# 認真 (bottom-right of office-life set) — clean upper-body framing,
# centered face, friendly upward gesture. Tweak if a future sample-grid
# has a better cell.
HERO_CELL_INDEX = 8

LINE_GREEN = (6, 199, 85)
LINE_GREEN_DEEP = (4, 169, 71)
LINE_GREEN_SOFT = (218, 245, 226)
WHITE = (255, 255, 255)
CREAM_BG = (246, 249, 245)

FONT_BLACK = "/home/ct/.local/share/fonts/NotoSansTC-Black.ttf"


def chroma_key_green(img: Image.Image,
                      threshold: float = 0.18,
                      despill_threshold: float = 0.05) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            greenness = (g - (r + b) / 2) / 255
            if greenness > threshold:
                px[x, y] = (r, g, b, 0)
            elif greenness > despill_threshold:
                cap = int((r + b) / 2)
                px[x, y] = (r, min(g, cap), b, a)
    return rgba


def erode_alpha(img: Image.Image, passes: int = 1) -> Image.Image:
    """N-pixel alpha erosion to clean up the half-alpha green-tinted
    fringe that chroma keying leaves behind."""
    rgba = img.convert("RGBA")
    for _ in range(passes):
        w, h = rgba.size
        src_alpha = rgba.split()[3].load()
        out = rgba.copy()
        out_px = out.load()
        for y in range(h):
            for x in range(w):
                if src_alpha[x, y] == 0:
                    continue
                if (
                    (x > 0 and src_alpha[x - 1, y] == 0) or
                    (x < w - 1 and src_alpha[x + 1, y] == 0) or
                    (y > 0 and src_alpha[x, y - 1] == 0) or
                    (y < h - 1 and src_alpha[x, y + 1] == 0)
                ):
                    r, g, b, _ = out_px[x, y]
                    out_px[x, y] = (r, g, b, 0)
        rgba = out
    return rgba


# Inset cell crop to avoid bleed from neighbouring grid cells. Icons
# render this cell BIG, so any leftover edge fringe is glaringly
# visible — use a slightly bigger inset than make_og.py's 0.03.
SPLIT_INSET_RATIO = 0.04


def get_hero_face(src_path: Path) -> Image.Image | None:
    if not src_path.is_file():
        return None
    src = Image.open(src_path).convert("RGB")
    keyed = chroma_key_green(src)
    # 2-pass erode for icons (more aggressive than OG since hero is
    # zoomed in big and any fringe will be visible)
    keyed = erode_alpha(keyed, passes=2)
    w, h = keyed.size
    tw, th = w // 3, h // 3
    inset_x = int(tw * SPLIT_INSET_RATIO)
    inset_y = int(th * SPLIT_INSET_RATIO)
    r, c = HERO_CELL_INDEX // 3, HERO_CELL_INDEX % 3
    return keyed.crop((
        c * tw + inset_x,
        r * th + inset_y,
        (c + 1) * tw - inset_x,
        (r + 1) * th - inset_y,
    ))


def draw_icon_with_hero(hero: Image.Image, size: int,
                         safe_fraction: float = 1.0,
                         background: tuple | None = None) -> Image.Image:
    """LINE-green rounded tile + the hero portrait inside, with the
    title 「LINE」 wordmark as a small ribbon at the top so even at
    small sizes it reads as 'LINE sticker tool'."""
    canvas = Image.new("RGBA", (size, size),
                       background + (255,) if background else (0, 0, 0, 0))

    inner = int(size * safe_fraction)
    ix = (size - inner) // 2
    iy = (size - inner) // 2

    radius = max(8, int(inner * 0.22))

    # Drop shadow
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    s_off = max(2, inner // 60)
    sd.rounded_rectangle((ix + s_off, iy + s_off * 2,
                          ix + inner + s_off, iy + inner + s_off * 2),
                         radius=radius, fill=(0, 0, 0, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, inner // 80)))
    canvas = Image.alpha_composite(canvas, shadow)

    # Green tile
    tile = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rounded_rectangle((0, 0, inner, inner), radius=radius, fill=LINE_GREEN)
    # Soft top glow
    glow = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle((6, 6, inner - 6, int(inner * 0.18)),
                         radius=radius, fill=(255, 255, 255, 36))
    glow = glow.filter(ImageFilter.GaussianBlur(max(2, inner // 100)))
    tile.alpha_composite(glow)

    # Inner white plate that holds the portrait
    pad = int(inner * 0.10)
    plate_size = inner - pad * 2
    plate = Image.new("RGBA", (plate_size, plate_size), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    plate_radius = max(6, int(plate_size * 0.12))
    pd.rounded_rectangle((0, 0, plate_size, plate_size),
                         radius=plate_radius, fill=WHITE)
    # Resize hero to fit the plate (with small inset so character isn't
    # touching plate edges)
    inset = max(2, plate_size // 20)
    hero_size = plate_size - inset * 2
    hero_resized = hero.resize((hero_size, hero_size), Image.LANCZOS)
    plate.alpha_composite(hero_resized, (inset, inset))
    # Round corners of the plate by re-masking
    mask = Image.new("L", (plate_size, plate_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, plate_size, plate_size), radius=plate_radius, fill=255
    )
    plate.putalpha(mask)
    tile.alpha_composite(plate, (pad, pad))

    canvas.alpha_composite(tile, (ix, iy))
    return canvas


def draw_brand_only_icon(size: int, safe_fraction: float = 1.0,
                          background: tuple | None = None) -> Image.Image:
    """Fallback: green tile + white LINE wordmark + tiny 3×3 grid."""
    canvas = Image.new("RGBA", (size, size),
                       background + (255,) if background else (0, 0, 0, 0))
    inner = int(size * safe_fraction)
    ix = (size - inner) // 2
    iy = (size - inner) // 2
    radius = max(8, int(inner * 0.22))

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    s_off = max(2, inner // 60)
    sd.rounded_rectangle((ix + s_off, iy + s_off * 2,
                          ix + inner + s_off, iy + inner + s_off * 2),
                         radius=radius, fill=(0, 0, 0, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, inner // 80)))
    canvas = Image.alpha_composite(canvas, shadow)

    tile = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rounded_rectangle((0, 0, inner, inner), radius=radius, fill=LINE_GREEN)
    canvas.alpha_composite(tile, (ix, iy))

    wd = ImageDraw.Draw(canvas)
    fsize = int(inner * 0.34)
    font = ImageFont.truetype(FONT_BLACK, fsize)
    bbox = wd.textbbox((0, 0), "LINE", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    wd.text((ix + (inner - tw) // 2 - bbox[0],
             iy + int(inner * 0.20) - bbox[1]),
            "LINE", fill=WHITE, font=font)

    grid_total = int(inner * 0.36)
    cell = grid_total // 3
    gap = max(1, cell // 8)
    real_total = cell * 3 + gap * 2
    gx = ix + (inner - real_total) // 2
    gy = iy + int(inner * 0.62)
    for r in range(3):
        for c in range(3):
            x = gx + c * (cell + gap)
            y = gy + r * (cell + gap)
            wd.rounded_rectangle((x, y, x + cell, y + cell),
                                 radius=max(2, cell // 4), fill=WHITE)
    return canvas


def main() -> None:
    src_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    hero = get_hero_face(src_path)

    if hero:
        print(f"  using hero face from {src_path} (cell {HERO_CELL_INDEX})")
        def render(size, safe=1.0, bg=None):
            return draw_icon_with_hero(hero, size, safe_fraction=safe, background=bg)
    else:
        print(f"  no source at {src_path}, using brand-only icon")
        def render(size, safe=1.0, bg=None):
            return draw_brand_only_icon(size, safe_fraction=safe, background=bg)

    render(192).save(ROOT / "icon-192.png", "PNG", optimize=True)
    render(512).save(ROOT / "icon-512.png", "PNG", optimize=True)
    render(512, safe=0.82, bg=CREAM_BG).save(
        ROOT / "icon-maskable.png", "PNG", optimize=True
    )
    apple = render(360, bg=CREAM_BG).resize((180, 180), Image.LANCZOS).convert("RGB")
    apple.save(ROOT / "apple-touch-icon.png", "PNG", optimize=True)
    favi = render(256, bg=CREAM_BG)
    favi.save(ROOT / "favicon.ico",
              format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    for name in ("icon-192.png", "icon-512.png", "icon-maskable.png",
                 "apple-touch-icon.png", "favicon.ico"):
        p = ROOT / name
        print(f"saved {name} ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
