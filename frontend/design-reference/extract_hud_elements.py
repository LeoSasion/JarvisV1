from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design-reference" / "jarvis-night-shell-v1-approved.png"
OUTPUT = ROOT / "public" / "assets"

ASSETS = {
    "jarvis-top-brand-core-v1.png": {
        "box": (30, 19, 78, 67),
        "canvas": (52, 52),
        "offset": (2, 2),
    },
    "jarvis-top-agent-ready-core-v1.png": {
        "box": (829, 22, 873, 66),
        "canvas": (52, 52),
        "offset": (4, 4),
    },
    "jarvis-right-core-status-v1.png": {
        "box": (1279, 114, 1371, 206),
        "canvas": (96, 96),
        "offset": (2, 3),
    },
    "jarvis-taskbar-core-launcher-v1.png": {
        "box": (944, 834, 1032, 926),
        "canvas": (96, 96),
        "offset": (4, 0),
    },
}


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def estimate_background(image):
    width, height = image.size
    border = []
    for y in range(height):
        for x in range(width):
            if x < 4 or y < 4 or x >= width - 4 or y >= height - 4:
                border.append(image.getpixel((x, y)))
    return tuple(percentile([pixel[channel] for pixel in border], 0.25) for channel in range(3))


def extract_glow(image):
    background = estimate_background(image)
    rgba = Image.new("RGBA", image.size, (0, 0, 0, 0))
    output = []

    for red, green, blue in image.get_flattened_data():
        delta = (
            max(0, red - background[0]),
            max(0, green - background[1]),
            max(0, blue - background[2]),
        )
        peak = max(delta)
        if peak <= 2:
            output.append((0, 0, 0, 0))
            continue

        alpha = min(255, peak)
        output.append(tuple(min(255, round(channel * 255 / peak)) for channel in delta) + (alpha,))

    rgba.putdata(output)
    return rgba


def main():
    source = Image.open(SOURCE).convert("RGB")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    for filename, spec in ASSETS.items():
        crop = extract_glow(source.crop(spec["box"]))
        canvas = Image.new("RGBA", spec["canvas"], (0, 0, 0, 0))
        canvas.alpha_composite(crop, dest=spec["offset"])
        canvas.save(OUTPUT / filename, format="PNG", compress_level=6)
        print(f"{filename}: {canvas.size[0]}x{canvas.size[1]}")


if __name__ == "__main__":
    main()
