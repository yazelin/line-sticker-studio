"""Generate PWA icons + favicon for LINE 貼圖製造機.

Self-contained: no source image. Renders a LINE-green branded icon —
a glossy rounded "LINE" tile with a tiny 3×3 grid badge.

Usage: python3 make_icons.py
Outputs:
  icon-192.png / icon-512.png     — standard, full-bleed
  icon-maskable.png               — 80% safe-zone for Android adaptive
  apple-touch-icon.png            — 180×180
  favicon.ico                     — 16/32/48
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).parent

LINE_GREEN = (6, 199, 85)
LINE_GREEN_DEEP = (4, 169, 71)
WHITE = (255, 255, 255)
CREAM_BG = (246, 249, 245)

FONT_BLACK = "/home/ct/.local/share/fonts/NotoSansTC-Black.ttf"


def draw_icon(size: int, safe_fraction: float = 1.0,
              background: tuple | None = None) -> Image.Image:
    """LINE 貼圖製造機 icon: green rounded square with a glyphic
    "LINE" wordmark + a tiny 3×3 grid showing this is a sticker tool.
    """
    canvas = Image.new("RGBA", (size, size),
                       background + (255,) if background else (0, 0, 0, 0))

    inner = int(size * safe_fraction)
    ix = (size - inner) // 2
    iy = (size - inner) // 2

    # Drop shadow under the tile
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    s_off = max(2, inner // 60)
    radius = max(8, int(inner * 0.22))
    sd.rounded_rectangle((ix + s_off, iy + s_off * 2,
                          ix + inner + s_off, iy + inner + s_off * 2),
                         radius=radius, fill=(0, 0, 0, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, inner // 80)))
    canvas = Image.alpha_composite(canvas, shadow)

    # The green tile
    tile = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rounded_rectangle((0, 0, inner, inner), radius=radius, fill=LINE_GREEN)
    # Subtle top-edge glow (single hairline) for that glossy iOS-icon feel,
    # without the giant arc-scratch the previous version had.
    glow = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle((6, 6, inner - 6, int(inner * 0.18)),
                         radius=radius, fill=(255, 255, 255, 36))
    glow = glow.filter(ImageFilter.GaussianBlur(max(2, inner // 100)))
    tile.alpha_composite(glow)
    canvas.alpha_composite(tile, (ix, iy))

    # White "LINE" wordmark, sized to ~50% of the tile width
    wd = ImageDraw.Draw(canvas)
    target_h = int(inner * 0.32)
    # Pick a font size that yields ~target_h
    fsize = int(target_h * 1.05)
    font = ImageFont.truetype(FONT_BLACK, fsize)
    word = "LINE"
    bbox = wd.textbbox((0, 0), word, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = ix + (inner - tw) // 2 - bbox[0]
    ty = iy + int(inner * 0.20) - bbox[1]
    wd.text((tx, ty), word, fill=WHITE, font=font)

    # Tiny 3×3 grid below to convey "貼圖" / sticker pack
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


def round_to_circle(img: Image.Image) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, *img.size), fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask=mask)
    return out


def main() -> None:
    def render(size, safe=1.0, bg=None):
        return draw_icon(size, safe_fraction=safe, background=bg)

    render(192).save(ROOT / "icon-192.png", "PNG", optimize=True)
    render(512).save(ROOT / "icon-512.png", "PNG", optimize=True)

    # Maskable: cream bg + 82% safe zone for Android adaptive
    render(512, safe=0.82, bg=CREAM_BG).save(
        ROOT / "icon-maskable.png", "PNG", optimize=True
    )

    # Apple touch icon: opaque, iOS rounds for us
    apple = render(360, bg=CREAM_BG).resize((180, 180), Image.LANCZOS).convert("RGB")
    apple.save(ROOT / "apple-touch-icon.png", "PNG", optimize=True)

    # Favicon: multi-size .ico
    favi = render(256, bg=CREAM_BG)
    favi.save(ROOT / "favicon.ico",
              format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    for name in ("icon-192.png", "icon-512.png", "icon-maskable.png",
                 "apple-touch-icon.png", "favicon.ico"):
        p = ROOT / name
        print(f"saved {name} ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
