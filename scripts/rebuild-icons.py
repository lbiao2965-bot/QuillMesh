from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PNG_PATH = ROOT / "resources" / "icon.png"
ICO_PATH = ROOT / "resources" / "icon.ico"
ICNS_PATH = ROOT / "resources" / "icon.icns"

# The rounded-square edge was originally composited over white. Its edge is a
# blend between white and the logo's navy surface, so reconstruct alpha from
# that blend while leaving the teal/orange artwork untouched.
WHITE = (255, 255, 255)
NAVY = (1, 15, 50)


def edge_alpha(pixel: tuple[int, int, int]) -> tuple[bool, int]:
    ratios = [
        (WHITE[channel] - pixel[channel]) / (WHITE[channel] - NAVY[channel])
        for channel in range(3)
    ]
    ratios.sort()
    alpha = ratios[1]
    is_white_navy_blend = max(ratios) - min(ratios) <= 0.15 and alpha < 0.995
    alpha_byte = max(0, min(255, round(alpha * 255)))
    if alpha_byte <= 12:
        alpha_byte = 0
    return is_white_navy_blend, alpha_byte


def clean_transparency(source: Image.Image) -> Image.Image:
    existing = source.convert("RGBA")
    if existing.getchannel("A").getextrema()[0] < 255:
        return existing

    rgb = source.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index]:
            return
        candidate, _ = edge_alpha(pixels[x, y])
        if candidate:
            visited[index] = 1
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    result = rgb.convert("RGBA")
    output = result.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if not visited[row + x]:
                continue
            _, alpha = edge_alpha(pixels[x, y])
            output[x, y] = (*NAVY, alpha)
    return result


def main() -> None:
    clean = clean_transparency(Image.open(PNG_PATH))
    clean.save(PNG_PATH, optimize=True)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    clean.save(ICO_PATH, format="ICO", sizes=ico_sizes, bitmap_format="png")

    mac_source = clean.resize((1024, 1024), Image.Resampling.LANCZOS)
    mac_source.save(ICNS_PATH, format="ICNS")

    print(f"Rebuilt transparent icons from {PNG_PATH.name}")


if __name__ == "__main__":
    main()
