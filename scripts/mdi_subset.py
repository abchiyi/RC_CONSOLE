#!/usr/bin/env python3
"""
mdi_subset.py — Material Design Icons 子集化

扫描 rc-app/src 中实际用到的 mdi-* 图标，从 @mdi/font 的 woff2 中抽取对应
字形生成子集字体与 CSS，替换全量 3.6MB 字体 + 800KB CSS，显著缩小 Web 控制台
静态资源体积（适配 ESP32 FAT 分区 3.875MB 限制）。

用法: python scripts/mdi_subset.py
输出:
  - src/assets/mdi-subset.woff2  (子集字体)
  - src/styles/mdi-subset.css    (仅包含用到的图标定义)
"""
import os
import re
import sys
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
MDI_CSS = ROOT / "node_modules" / "@mdi" / "font" / "css" / "materialdesignicons.css"
MDI_WOFF2 = ROOT / "node_modules" / "@mdi" / "font" / "fonts" / "materialdesignicons-webfont.woff2"
OUT_FONT = SRC / "assets" / "mdi-subset.woff2"
OUT_CSS = SRC / "styles" / "mdi-subset.css"

ICON_RE = re.compile(r"mdi-([a-z0-9-]+)")
CSS_RE = re.compile(r"\.mdi-([a-z0-9-]+)::before\s*\{[^}]*content:\s*\"\\F([0-9A-Fa-f]+)\"")


def collect_icons() -> set[str]:
    icons: set[str] = set()
    for root, _, files in os.walk(SRC):
        for f in files:
            if not f.endswith((".vue", ".ts", ".js", ".tsx", ".jsx")):
                continue
            text = Path(root, f).read_text(encoding="utf-8", errors="ignore")
            icons.update(ICON_RE.findall(text))
    return icons


def parse_mapping() -> dict[str, str]:
    if not MDI_CSS.exists():
        print(f"[ERR] 找不到 {MDI_CSS}", file=sys.stderr)
        sys.exit(1)
    text = MDI_CSS.read_text(encoding="utf-8")
    mapping: dict[str, str] = {}
    for name, cp in CSS_RE.findall(text):
        mapping[name] = cp
    return mapping


def main() -> None:
    icons = collect_icons()
    mapping = parse_mapping()

    used = {name for name in icons if name in mapping}
    missing = sorted(icons - used)
    if missing:
        print(f"[WARN] 以下图标未在 @mdi/font 中找到定义: {missing}")

    # CSS 中 content: "\F0026" → 码位 U+F0026（mdi 使用私有区 F0000 起）
    codepoints = [int("F" + mapping[name], 16) for name in used]
    if not codepoints:
        print("[ERR] 未扫描到任何 mdi 图标", file=sys.stderr)
        sys.exit(1)

    print(f"使用图标: {len(used)} 个")
    for name in sorted(used):
        print(f"  - {name}")

    opts = subset.Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.ignore_missing_glyphs = True

    font = subset.load_font(str(MDI_WOFF2), opts)
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    OUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(OUT_FONT))
    print(f"字体输出: {OUT_FONT} ({OUT_FONT.stat().st_size / 1024:.1f} KB)")

    lines = [
        "/* 由 scripts/mdi_subset.py 自动生成 — 勿手改；新增图标后重新运行 */",
        "@font-face {",
        "  font-family: 'Material Design Icons';",
        "  src: url('../assets/mdi-subset.woff2') format('woff2');",
        "  font-weight: normal;",
        "  font-style: normal;",
        "  font-display: block;",
        "}",
        ".mdi:before {",
        "  font-family: 'Material Design Icons';",
        "  font-size: inherit;",
        "  line-height: 1;",
        "  font-style: normal;",
        "  font-variant: normal;",
        "  font-weight: normal;",
        "  text-rendering: auto;",
        "  -webkit-font-smoothing: antialiased;",
        "  -moz-osx-font-smoothing: grayscale;",
        "  display: inline-block;",
        "}",
    ]
    for name in sorted(used):
        lines.append(f".mdi-{name}:before {{ content: \"\\F{mapping[name]}\"; }}")

    OUT_CSS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"CSS 输出: {OUT_CSS}")


if __name__ == "__main__":
    main()
