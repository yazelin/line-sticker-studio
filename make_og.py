"""Generate a 1200×630 Open Graph image for LINE 貼圖製造機.

Uses assets/sample-grid.jpg (a real Gemini output) as the hero image,
chroma-keys out the green background, composites the 9 chat-stickers
onto the OG layout. Falls back to a placeholder grid if no source.

Usage: python3 make_og.py [path/to/grid.png|jpg]
Output: og.png
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).parent
DEFAULT_SOURCE = ROOT / "assets" / "sample-grid.jpg"

# LINE green palette
LINE_GREEN = (6, 199, 85)
LINE_GREEN_DEEP = (4, 169, 71)
LINE_GREEN_SOFT = (218, 245, 226)
BG = (246, 249, 245)
TEXT = (28, 36, 30)
MUTED = (110, 122, 113)
ACCENT = (255, 196, 84)

W, H = 1200, 630
GRID_SIZE = 460
GRID_X = 70
GRID_Y = (H - GRID_SIZE) // 2

FONT_BLACK = "/home/ct/.local/share/fonts/NotoSansTC-Black.ttf"
FONT_BOLD = "/home/ct/.local/share/fonts/NotoSansTC-Bold.ttf"
FONT_REG = "/home/ct/.local/share/fonts/NotoSansTC-Light.ttf"


def chroma_key_green(img: Image.Image,
                      threshold: float = 0.20,
                      despill_threshold: float = 0.05) -> Image.Image:
    """Same algorithm as the frontend's chromaKeyGreen() in app.js:
    α=0 where greenness > threshold, despill at edges by capping G to (R+B)/2.
    """
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
                # Cap green channel
                cap = int((r + b) / 2)
                px[x, y] = (r, min(g, cap), b, a)
    return rgba


def split_to_9_tiles(img: Image.Image):
    """Split a 3×3 grid into 9 PIL images."""
    w, h = img.size
    tw, th = w // 3, h // 3
    return [
        img.crop((c * tw, r * th, (c + 1) * tw, (r + 1) * th))
        for r in range(3) for c in range(3)
    ]


def make_real_sticker_grid(src_path: Path, size: int) -> Image.Image:
    """Take the real Gemini grid → chroma-key → re-tile onto a clean
    LINE-soft-green panel with subtle gaps."""
    print(f"  loading source: {src_path}")
    src = Image.open(src_path).convert("RGB")
    print(f"  chroma-keying green background…")
    keyed = chroma_key_green(src)
    tiles = split_to_9_tiles(keyed)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gap = max(4, size // 80)
    cell = (size - 2 * gap) // 3
    radius = max(8, cell // 12)

    for i, tile in enumerate(tiles):
        r, c = i // 3, i % 3
        x = c * (cell + gap)
        y = r * (cell + gap)
        # Background plate (off-white, subtle border)
        plate = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        pd = ImageDraw.Draw(plate)
        pd.rounded_rectangle((0, 0, cell, cell), radius=radius,
                             fill=(255, 255, 255, 255),
                             outline=LINE_GREEN_SOFT, width=2)
        # Resize tile and paste with alpha
        scaled = tile.resize((cell - 6, cell - 6), Image.LANCZOS)
        plate.alpha_composite(scaled, (3, 3))

        # Soft drop shadow
        shadow = Image.new("RGBA", (cell + 6, cell + 6), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle((3, 5, cell + 3, cell + 5),
                             radius=radius, fill=(0, 0, 0, 38))
        shadow = shadow.filter(ImageFilter.GaussianBlur(2))
        canvas.alpha_composite(shadow, (x - 3, y - 3))
        canvas.alpha_composite(plate, (x, y))
    return canvas


def make_placeholder_grid(size: int) -> Image.Image:
    """Fallback when no source asset is present — minimalist flat tiles."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gap = max(4, size // 60)
    tile = (size - 2 * gap) // 3
    radius = max(8, tile // 8)
    for r in range(3):
        for c in range(3):
            x = c * (tile + gap)
            y = r * (tile + gap)
            d = ImageDraw.Draw(canvas)
            d.rounded_rectangle((x, y, x + tile, y + tile),
                                radius=radius,
                                fill=LINE_GREEN_SOFT,
                                outline=LINE_GREEN, width=3)
    return canvas


def main() -> None:
    src_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE

    canvas = Image.new("RGBA", (W, H), BG + (255,))

    # Soft background blobs
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((-200, -180, 320, 320), fill=LINE_GREEN + (28,))
    od.ellipse((W - 280, H - 260, W + 220, H + 220), fill=ACCENT + (24,))
    canvas = Image.alpha_composite(canvas, overlay)

    if src_path.is_file():
        grid = make_real_sticker_grid(src_path, GRID_SIZE)
    else:
        print(f"  no source at {src_path}, using placeholder grid")
        grid = make_placeholder_grid(GRID_SIZE)
    canvas.alpha_composite(grid, (GRID_X, GRID_Y))

    # Text column
    d = ImageDraw.Draw(canvas)
    text_x = GRID_X + GRID_SIZE + 70
    title_font = ImageFont.truetype(FONT_BLACK, 78)
    tag_font = ImageFont.truetype(FONT_REG, 26)
    cta_font = ImageFont.truetype(FONT_BOLD, 26)
    pill_font = ImageFont.truetype(FONT_BOLD, 22)

    # LINE pill mark
    pill_w, pill_h = 86, 38
    d.rounded_rectangle((text_x, 130, text_x + pill_w, 130 + pill_h),
                        radius=pill_h // 2, fill=LINE_GREEN)
    d.text((text_x + 14, 132), "LINE", fill=(255, 255, 255), font=pill_font)
    d.text((text_x + pill_w + 12, 130), "貼圖製造機",
           fill=TEXT, font=ImageFont.truetype(FONT_BOLD, 32))

    # Big title
    d.text((text_x, 198), "1 張角色圖", fill=TEXT, font=title_font)
    d.text((text_x, 282), "→ 一整套貼圖", fill=LINE_GREEN_DEEP, font=title_font)

    # Tagline
    d.text((text_x, 388), "AI 60 秒產 8 張同角色不同表情", fill=MUTED, font=tag_font)
    d.text((text_x, 422), "下載 ZIP 直接上架 LINE Creators Market", fill=MUTED, font=tag_font)

    # CTA pill
    cta_text = "點開上傳一張角色圖 →"
    bbox = d.textbbox((0, 0), cta_text, font=cta_font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    pad_x, pad_y = 28, 16
    pw = text_w + pad_x * 2
    ph = text_h + pad_y * 2
    py = 482
    d.rounded_rectangle((text_x, py, text_x + pw, py + ph),
                        radius=ph // 2, fill=LINE_GREEN)
    d.text((text_x + pad_x - bbox[0], py + pad_y - bbox[1]),
           cta_text, fill=(255, 255, 255), font=cta_font)

    canvas = canvas.convert("RGB")
    out_path = ROOT / "og.png"
    canvas.save(out_path, "PNG", optimize=True)
    print(f"saved {out_path} ({out_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
