"""Generate a 1200×630 Open Graph image for LINE 貼圖製造機.

Self-contained: no source image needed. Renders a stylised 3×3 grid of
sticker placeholders + brand title + tagline + CTA, using LINE-green
palette.

Usage: python3 make_og.py
Output: og.png
"""

from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).parent

# LINE green palette (matches styles.css --line-green family)
LINE_GREEN = (6, 199, 85)        # #06c755
LINE_GREEN_DEEP = (4, 169, 71)   # #04a947
LINE_GREEN_SOFT = (218, 245, 226) # tile background
BG = (246, 249, 245)             # --bg
TEXT = (28, 36, 30)
MUTED = (110, 122, 113)
ACCENT = (255, 196, 84)          # warm yellow accent

W, H = 1200, 630
GRID_SIZE = 460
GRID_X = 70
GRID_Y = (H - GRID_SIZE) // 2

FONT_BLACK = "/home/ct/.local/share/fonts/NotoSansTC-Black.ttf"
FONT_BOLD = "/home/ct/.local/share/fonts/NotoSansTC-Bold.ttf"
FONT_REG = "/home/ct/.local/share/fonts/NotoSansTC-Light.ttf"


def rounded_corners(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(((0, 0), img.size), radius=radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask=mask)
    return out


def draw_face(d: ImageDraw.ImageDraw, cx: int, cy: int, size: int, kind: int) -> None:
    """Draw a tiny minimalist face onto an existing draw context.
    kind 0..8 → different expression so all 9 cells differ.
    """
    r = size // 2 - 4
    # Face circle
    d.ellipse((cx - r, cy - r, cx + r, cy + r),
              fill=(255, 246, 220), outline=(35, 35, 35), width=3)
    # Eyes
    eye_y = cy - r // 4
    eye_dx = r // 2
    eye_size = max(2, r // 7)
    expressions = [
        # (left_eye, right_eye, mouth)
        ("dot", "dot", "smile"),         # 0 happy
        ("wink", "dot", "smirk"),        # 1 wink
        ("closed", "closed", "openLaugh"), # 2 lol
        ("dot", "dot", "frown"),         # 3 sad
        ("X", "X", "openShock"),         # 4 shock
        ("heart", "heart", "smile"),     # 5 love
        ("dot", "dot", "tongue"),        # 6 cheeky
        ("squint", "squint", "smug"),    # 7 sly
        ("dot", "dot", "tinyLine"),      # 8 deadpan
    ]
    le, re, mo = expressions[kind % len(expressions)]

    def eye(x, y, kind_):
        if kind_ == "dot":
            d.ellipse((x - eye_size, y - eye_size, x + eye_size, y + eye_size),
                      fill=(35, 35, 35))
        elif kind_ == "closed":
            d.arc((x - eye_size * 1.5, y - eye_size, x + eye_size * 1.5, y + eye_size),
                  start=0, end=180, fill=(35, 35, 35), width=2)
        elif kind_ == "wink":
            d.line((x - eye_size * 1.5, y, x + eye_size * 1.5, y),
                   fill=(35, 35, 35), width=3)
        elif kind_ == "X":
            d.line((x - eye_size, y - eye_size, x + eye_size, y + eye_size),
                   fill=(35, 35, 35), width=3)
            d.line((x - eye_size, y + eye_size, x + eye_size, y - eye_size),
                   fill=(35, 35, 35), width=3)
        elif kind_ == "heart":
            d.ellipse((x - eye_size, y - eye_size, x + eye_size // 2, y + eye_size // 2),
                      fill=(220, 70, 90))
            d.ellipse((x - eye_size // 2, y - eye_size, x + eye_size, y + eye_size // 2),
                      fill=(220, 70, 90))
            d.polygon((x - eye_size, y, x + eye_size, y, x, y + eye_size * 1.5),
                      fill=(220, 70, 90))
        elif kind_ == "squint":
            d.line((x - eye_size * 1.5, y - eye_size // 2, x + eye_size * 1.5, y + eye_size // 2),
                   fill=(35, 35, 35), width=3)

    eye(cx - eye_dx, eye_y, le)
    eye(cx + eye_dx, eye_y, re)

    # Mouth
    mouth_y = cy + r // 3
    mouth_w = r // 2
    if mo == "smile":
        d.arc((cx - mouth_w, mouth_y - mouth_w // 2, cx + mouth_w, mouth_y + mouth_w),
              start=0, end=180, fill=(35, 35, 35), width=3)
    elif mo == "smirk":
        d.arc((cx - mouth_w, mouth_y, cx + mouth_w, mouth_y + mouth_w),
              start=0, end=90, fill=(35, 35, 35), width=3)
    elif mo == "openLaugh":
        d.ellipse((cx - mouth_w // 2, mouth_y - 2, cx + mouth_w // 2, mouth_y + mouth_w),
                  fill=(80, 30, 30), outline=(35, 35, 35), width=2)
    elif mo == "frown":
        d.arc((cx - mouth_w, mouth_y, cx + mouth_w, mouth_y + mouth_w),
              start=180, end=360, fill=(35, 35, 35), width=3)
    elif mo == "openShock":
        d.ellipse((cx - mouth_w // 3, mouth_y - mouth_w // 3,
                   cx + mouth_w // 3, mouth_y + mouth_w // 3),
                  fill=(80, 30, 30), outline=(35, 35, 35), width=2)
    elif mo == "tongue":
        d.arc((cx - mouth_w, mouth_y - mouth_w // 2, cx + mouth_w, mouth_y + mouth_w),
              start=0, end=180, fill=(35, 35, 35), width=3)
        d.ellipse((cx + 2, mouth_y + mouth_w // 4,
                   cx + mouth_w // 2, mouth_y + mouth_w),
                  fill=(220, 100, 110), outline=(35, 35, 35), width=2)
    elif mo == "smug":
        d.line((cx - mouth_w // 2, mouth_y, cx + mouth_w // 2, mouth_y),
               fill=(35, 35, 35), width=3)
        d.line((cx + mouth_w // 2, mouth_y, cx + mouth_w // 2 + 4, mouth_y - 6),
               fill=(35, 35, 35), width=3)
    elif mo == "tinyLine":
        d.line((cx - mouth_w // 3, mouth_y, cx + mouth_w // 3, mouth_y),
               fill=(35, 35, 35), width=3)


def make_sticker_grid(size: int) -> Image.Image:
    """3×3 of mini faces with soft gaps."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gap = max(4, size // 60)
    tile = (size - 2 * gap) // 3
    radius = max(8, tile // 8)
    for r in range(3):
        for c in range(3):
            x = c * (tile + gap)
            y = r * (tile + gap)
            tile_img = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
            td = ImageDraw.Draw(tile_img)
            td.rounded_rectangle((0, 0, tile, tile), radius=radius,
                                 fill=LINE_GREEN_SOFT,
                                 outline=LINE_GREEN, width=3)
            draw_face(td, tile // 2, tile // 2, tile, r * 3 + c)
            # Tiny shadow
            shadow = Image.new("RGBA", (tile + 4, tile + 4), (0, 0, 0, 0))
            sd = ImageDraw.Draw(shadow)
            sd.rounded_rectangle((2, 4, tile + 2, tile + 4),
                                 radius=radius, fill=(0, 0, 0, 38))
            shadow = shadow.filter(ImageFilter.GaussianBlur(2))
            canvas.alpha_composite(shadow, (x - 2, y - 2))
            canvas.alpha_composite(tile_img, (x, y))
    return canvas


def main() -> None:
    canvas = Image.new("RGBA", (W, H), BG + (255,))

    # Soft background blobs
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((-200, -180, 320, 320), fill=LINE_GREEN + (28,))
    od.ellipse((W - 280, H - 260, W + 220, H + 220), fill=ACCENT + (24,))
    canvas = Image.alpha_composite(canvas, overlay)

    # 3×3 sticker grid
    grid = make_sticker_grid(GRID_SIZE)
    canvas.alpha_composite(grid, (GRID_X, GRID_Y))

    # Text column
    d = ImageDraw.Draw(canvas)
    text_x = GRID_X + GRID_SIZE + 70
    title_font = ImageFont.truetype(FONT_BLACK, 78)
    tag_font = ImageFont.truetype(FONT_REG, 26)
    sub_font = ImageFont.truetype(FONT_BOLD, 28)
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

    # CTA pill (no emoji — Noto Sans TC has no emoji glyphs and renders
    # them as tofu boxes; use a clean text-only pill.)
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
