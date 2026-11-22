#!/usr/bin/env python3
"""Regenerates the fonts the PDF export embeds for text outside WinAnsi (src/export/pdf/fonts/).

Maintainer tool, not part of the build: the generated modules are committed. Needs Python 3 and
fontTools 4 in a virtual environment (`python3 -m venv .venv-fonts`, then
`.venv-fonts/bin/pip install "fonttools>=4,<5"`; on Windows `.venv-fonts/Scripts/pip`), then

    .venv-fonts/bin/python packages/renderer/scripts/pdf-fonts.py

zlib builds differ in their compressed output, so a rerun may change the modules' bytes while
they still decode to the same fonts.

It downloads the pinned source fonts (checked by SHA-256), subsets them with fontTools (no
hinting, no OpenType layout: jsPDF draws one glyph per character, without shaping), and writes one
TypeScript module per font holding the TrueType file zlib-deflated and base64-encoded, plus
coverage.ts (the code points each font covers, as ranges, so the export knows which font a string
needs before it loads one). jsPDF subsets each font again to the glyphs a PDF uses.

  - sansRegular, sansBold: Noto Sans Regular and Bold (SIL OFL 1.1), Latin, Greek, Cyrillic.
  - cjk: Noto Sans Regular's Latin, Greek and Cyrillic merged with Droid Sans Fallback's
    (Apache 2.0) CJK Unified Ideographs (U+4E00-9FFF), kana, CJK punctuation and full-width forms,
    so mixed strings ("用户 ID") need one font. Noto is scaled to Droid's 256 units per em.
    No Hangul syllables, no CJK Extension A/B: those pages stay raster.
"""

import base64
import hashlib
import os
import subprocess
import sys
import tempfile
import urllib.request
import zlib

from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "export", "pdf", "fonts")

NOTO = (
    # The commit (2024-11-21) whose files match the SHA-256 sums below, not the moving main branch.
    "https://raw.githubusercontent.com/notofonts/notofonts.github.io/"
    "28b15b4b43b7bed62b5cf6e6b0b5ff5846270535/"
    "fonts/NotoSans/unhinted/ttf/"
)
SOURCES = {
    "noto-regular": (
        NOTO + "NotoSans-Regular.ttf",
        "f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8",
    ),
    "noto-bold": (
        NOTO + "NotoSans-Bold.ttf",
        "87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9",
    ),
    # googlesource serves raw files base64-encoded with ?format=TEXT.
    "droid": (
        "https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android10-release/"
        "data/fonts/DroidSansFallbackFull.ttf?format=TEXT",
        "2392015530438bafc48edfc4aee6d9de2387f627a6134d8ab3dfcc99d21c8240",
    ),
}

LATIN_GREEK_CYRILLIC = ",".join(
    [
        "U+0020-007E",
        "U+00A0-02FF",  # Latin-1, Latin Extended-A/B, IPA, spacing modifiers (no combining marks)
        "U+0370-03FF",  # Greek
        "U+0400-052F",  # Cyrillic, Cyrillic Supplement
        "U+1C80-1C8F",
        "U+1D00-1DBF",
        "U+1E00-1FFF",  # Latin Extended Additional (Vietnamese), Greek Extended
        "U+2000-206F",
        "U+20A0-20CF",
        "U+2100-218F",
        "U+2190-21FF",
        "U+2C60-2C7F",
        "U+2DE0-2DFF",
        "U+A640-A69F",
        "U+A720-A7FF",
        "U+FB00-FB06",
    ]
)
CJK = ",".join(
    [
        "U+3000-30FF",  # CJK punctuation, hiragana, katakana
        "U+3100-312F",
        "U+31F0-31FF",
        "U+3200-33FF",
        "U+4E00-9FFF",  # CJK Unified Ideographs
        "U+F900-FAFF",
        "U+FE30-FE4F",
        "U+FF00-FFEF",  # half-width and full-width forms
    ]
)

NOTO_COPYRIGHT = (
    "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)"
)
DROID_COPYRIGHT = (
    "Digitized data copyright Google Corporation (c) 2006; "
    "Copyright (C) 2008 The Android Open Source Project"
)

OPTIONS = [
    "--layout-features=",
    "--no-hinting",
    "--drop-tables+=GDEF,GPOS,GSUB,vhea,vmtx,gasp,DSIG,kern",
    "--name-IDs=0,1,2,3,4,5,6,7,13,14",
    "--notdef-outline",
    "--glyph-names=false",
]


def fetch(key, tmp):
    url, sha = SOURCES[key]
    with urllib.request.urlopen(url) as r:
        data = r.read()
    if "format=TEXT" in url:
        data = base64.b64decode(data)
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha:
        sys.exit(f"{key}: SHA-256 {digest} does not match the pinned {sha}")
    path = os.path.join(tmp, key + ".ttf")
    with open(path, "wb") as f:
        f.write(data)
    return path


def subset(src, unicodes, dst):
    subprocess.run(
        [sys.executable, "-m", "fontTools.subset", src, f"--unicodes={unicodes}", *OPTIONS]
        + [f"--output-file={dst}"],
        check=True,
    )
    return dst


def set_names(font, family, copyright_, license_):
    name = font["name"]
    name.names = [n for n in name.names if n.nameID in (0, 1, 2, 3, 4, 5, 6, 13, 14)]
    ps = family.replace(" ", "")
    for nid, value in {
        0: copyright_,
        1: family,
        2: "Regular",
        3: f"{ps}-Regular;relvista",
        4: family,
        6: f"{ps}-Regular",
        13: license_,
    }.items():
        name.setName(value, nid, 3, 1, 0x409)
        name.setName(value, nid, 1, 0, 0)


def ranges(codepoints):
    out = []
    for cp in sorted(codepoints):
        if out and out[-1][1] == cp - 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def write_module(fid, path, title, copyright_, license_):
    ttf = open(path, "rb").read()
    packed = base64.b64encode(zlib.compress(ttf, 9)).decode("ascii")
    with open(os.path.join(OUT, fid + ".ts"), "w", newline="\n") as f:
        f.write(
            f"/*! {title}, subset for relvista's PDF export (modified: subset, unhinted, no"
            " OpenType layout tables).\n"
            + "".join(f" * {line}\n" for line in copyright_.split("; "))
            + f" * @license {license_} (full texts: @relvista/renderer dist/export/pdf/fonts/LICENSES.md) */\n"
            "// Generated by packages/renderer/scripts/pdf-fonts.py; do not edit.\n"
            "/** The TrueType file, zlib-deflated, base64. */\n"
            f"export const data: string = '{packed}';\n"
        )
    print(f"{fid}: {len(ttf)} bytes TrueType, {len(packed)} bytes module")
    # jsPDF maps UTF-16 code units: only the Basic Multilingual Plane is drawable.
    return ranges(cp for cp in TTFont(path).getBestCmap() if cp <= 0xFFFF)


def main():
    coverage = {}
    with tempfile.TemporaryDirectory() as tmp:
        regular = fetch("noto-regular", tmp)
        bold = fetch("noto-bold", tmp)
        droid = fetch("droid", tmp)
        j = lambda name: os.path.join(tmp, name)  # noqa: E731

        lgc_regular = subset(regular, LATIN_GREEK_CYRILLIC, j("sansRegular.ttf"))
        lgc_bold = subset(bold, LATIN_GREEK_CYRILLIC, j("sansBold.ttf"))
        # Merging needs one em size: Noto's Latin goes to Droid's 256 units (1/256 em is far
        # below what print resolves; scaling Droid up instead makes the module 14 % larger).
        latin_part = TTFont(lgc_regular)
        scale_upem(latin_part, 256)
        latin_part.save(j("sansRegular-256.ttf"))
        subset(droid, CJK, j("droid-cjk.ttf"))
        merged = Merger().merge([j("sansRegular-256.ttf"), j("droid-cjk.ttf")])
        set_names(
            merged,
            "relvista PDF CJK",
            f"{NOTO_COPYRIGHT}; {DROID_COPYRIGHT}",
            "Noto Sans: SIL Open Font License 1.1; Droid Sans Fallback: Apache License 2.0",
        )
        # Reproducible output: the merge stamps head.created and .modified with the current time.
        droid_head = TTFont(j("droid-cjk.ttf"))["head"]
        merged["head"].created = droid_head.created
        merged["head"].modified = droid_head.modified
        merged.recalcTimestamp = False
        merged.save(j("cjk.ttf"))

        coverage["sansRegular"] = write_module(
            "sansRegular", lgc_regular, "Noto Sans Regular", NOTO_COPYRIGHT, "OFL-1.1"
        )
        coverage["sansBold"] = write_module(
            "sansBold", lgc_bold, "Noto Sans Bold", NOTO_COPYRIGHT, "OFL-1.1"
        )
        coverage["cjk"] = write_module(
            "cjk",
            j("cjk.ttf"),
            "Noto Sans Regular (Latin, Greek, Cyrillic) merged with Droid Sans Fallback (CJK)",
            f"{NOTO_COPYRIGHT}; {DROID_COPYRIGHT}",
            # A modified OFL font is distributed entirely under the OFL (OFL section 5); Apache 2.0
            # allows that for the Droid glyphs, whose notices and licence text stay with them.
            "OFL-1.1, with glyphs from Droid Sans Fallback under Apache-2.0",
        )
    with open(os.path.join(OUT, "coverage.ts"), "w", newline="\n") as f:
        f.write(
            "// Generated by packages/renderer/scripts/pdf-fonts.py; do not edit.\n"
            "/** Code points each embedded PDF font covers: flat inclusive [first, last] pairs. */\n"
            "export const FONT_COVERAGE = {\n"
        )
        for key, rs in coverage.items():
            f.write(f"  {key}: [{','.join(f'{a},{b}' for a, b in rs)}],\n")
        f.write("} as const;\n")
    for key, rs in coverage.items():
        print(f"{key}: {sum(b - a + 1 for a, b in rs)} code points in {len(rs)} ranges")


if __name__ == "__main__":
    main()
