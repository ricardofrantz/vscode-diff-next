"""Build marketplace icon.png for vscode-diff Next (PIL)."""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 512
ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    bg = (30, 34, 39, 255)
    margin = 24
    radius = 96
    d.rounded_rectangle(
        [margin, margin, SIZE - margin, SIZE - margin],
        radius=radius,
        fill=bg,
    )

    panel_gap = 28
    panel_w = 150
    panel_h = 280
    left_x = SIZE // 2 - panel_gap // 2 - panel_w
    right_x = SIZE // 2 + panel_gap // 2
    top = (SIZE - panel_h) // 2

    left_fill = (45, 90, 70, 255)
    right_fill = (90, 50, 55, 255)
    left_border = (80, 200, 120, 255)
    right_border = (230, 90, 100, 255)

    def panel(x: int, y: int, w: int, h: int, fill, border) -> None:
        d.rounded_rectangle(
            [x, y, x + w, y + h],
            radius=28,
            fill=fill,
            outline=border,
            width=6,
        )

    panel(left_x, top, panel_w, panel_h, left_fill, left_border)
    panel(right_x, top, panel_w, panel_h, right_fill, right_border)

    def lines(x: int, y: int, w: int, color, pattern) -> None:
        pad = 28
        ly = y + 40
        for frac in pattern:
            lw = int((w - 2 * pad) * frac)
            d.rounded_rectangle(
                [x + pad, ly, x + pad + lw, ly + 14],
                radius=4,
                fill=color,
            )
            ly += 36

    lines(left_x, top, panel_w, (120, 220, 150, 220), [0.85, 0.55, 0.70, 0.40, 0.75])
    lines(right_x, top, panel_w, (255, 140, 150, 220), [0.70, 0.85, 0.45, 0.65, 0.55])

    mid = SIZE // 2
    ay = SIZE // 2
    arrow_col = (220, 225, 230, 255)
    d.polygon(
        [(mid - 8, ay - 36), (mid + 22, ay - 22), (mid - 8, ay - 8)],
        fill=arrow_col,
    )
    d.polygon(
        [(mid + 8, ay + 8), (mid - 22, ay + 22), (mid + 8, ay + 36)],
        fill=arrow_col,
    )

    targets = [
        (256, ROOT / "icon.png"),
        (128, ROOT / "images" / "icon-128.png"),
        (256, ROOT / "images" / "logo.png"),
    ]
    for out_size, path in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        out = img.resize((out_size, out_size), Image.Resampling.LANCZOS)
        out.save(path, "PNG")
        print(f"wrote {path} {out.size} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
