# Indigo patterns, vol. 1: six original seamless SVG tiles, a zip of them, and a shelf cover.
import math, zipfile
from PIL import Image, ImageDraw

INK, CREAM = "#1f2c6e", "#f3ebdd"
S = 120  # tile size

def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}"><rect width="{S}" height="{S}" fill="{INK}"/>{body}</svg>\n'

tiles = {
  "01-moons": "".join(f'<circle cx="60" cy="60" r="{r}" fill="none" stroke="{CREAM}" stroke-width="5"/>' for r in (14, 30, 46)),
  "02-chevrons": "".join(f'<polyline points="0,{y} 30,{y-22} 60,{y} 90,{y-22} 120,{y}" fill="none" stroke="{CREAM}" stroke-width="7"/>' for y in (36, 76, 116)),
  "03-diamonds": f'<polygon points="60,10 110,60 60,110 10,60" fill="none" stroke="{CREAM}" stroke-width="6"/><polygon points="60,40 80,60 60,80 40,60" fill="{CREAM}"/>',
  "04-dots": "".join(f'<circle cx="{x}" cy="{y}" r="7" fill="{CREAM}"/>' for x in (20, 60, 100) for y in (20, 60, 100)),
  "05-triangles": f'<polygon points="0,120 60,10 120,120" fill="none" stroke="{CREAM}" stroke-width="6"/><polygon points="40,120 60,80 80,120" fill="{CREAM}"/>',
  "06-weave": "".join(f'<rect x="{x}" y="{y}" width="50" height="14" fill="{CREAM}"/>' for x, y in ((5, 23), (65, 83))) + "".join(f'<rect x="{x}" y="{y}" width="14" height="50" fill="{CREAM}"/>' for x, y in ((83, 5), (23, 65))),
}
for name, body in tiles.items():
    open(f"indigo/{name}.svg", "w").write(svg(body))
open("indigo/LICENSE.txt", "w").write("Indigo patterns, vol. 1. Made for the Paperstall demo shop and dedicated to the public domain (CC0 1.0).\nhttps://creativecommons.org/publicdomain/zero/1.0/\n")
open("indigo/README.txt", "w").write("Six seamless 120 px SVG tiles in indigo and cream. Scale them freely; each tile repeats edge to edge.\n")
with zipfile.ZipFile("indigo-patterns-vol1.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(__import__("os").listdir("indigo")):
        z.write(f"indigo/{f}", f"indigo-patterns-vol1/{f}")

# Cover: the six motifs drawn large in a 3x2 grid, 1200x900.
W, H = 1200, 900
img = Image.new("RGB", (W, H), INK)
d = ImageDraw.Draw(img)
cw, ch = W // 3, H // 2
def cell(i):
    return (i % 3) * cw, (i // 3) * ch
k = cw / S
for i in range(6):
    ox, oy = cell(i)
    cx, cy = ox + cw / 2, oy + ch / 2
    if i == 0:
        for r in (40, 85, 130):
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=CREAM, width=14)
    elif i == 1:
        for y in (cy - 120, cy, cy + 120):
            pts = [(ox + j * cw / 4, y + (0 if j % 2 == 0 else -60)) for j in range(5)]
            d.line(pts, fill=CREAM, width=18, joint="curve")
    elif i == 2:
        d.polygon([(cx, cy - 170), (cx + 170, cy), (cx, cy + 170), (cx - 170, cy)], outline=CREAM, width=16)
        d.polygon([(cx, cy - 60), (cx + 60, cy), (cx, cy + 60), (cx - 60, cy)], fill=CREAM)
    elif i == 3:
        for x in (-110, 0, 110):
            for y in (-110, 0, 110):
                d.ellipse([cx + x - 20, cy + y - 20, cx + x + 20, cy + y + 20], fill=CREAM)
    elif i == 4:
        d.polygon([(ox + 30, oy + ch - 40), (cx, oy + 50), (ox + cw - 30, oy + ch - 40)], outline=CREAM, width=16)
        d.polygon([(cx - 60, oy + ch - 40), (cx, oy + ch - 160), (cx + 60, oy + ch - 40)], fill=CREAM)
    else:
        d.rectangle([cx - 150, cy - 110, cx - 10, cy - 70], fill=CREAM)
        d.rectangle([cx + 10, cy + 70, cx + 150, cy + 110], fill=CREAM)
        d.rectangle([cx + 70, cy - 150, cx + 110, cy - 10], fill=CREAM)
        d.rectangle([cx - 110, cy + 10, cx - 70, cy + 150], fill=CREAM)
for x in (cw, 2 * cw):
    d.line([(x, 0), (x, H)], fill="#2c3b86", width=4)
d.line([(0, ch), (W, ch)], fill="#2c3b86", width=4)
img.save("indigo-cover.webp", "WEBP", quality=86)
print("ok")
