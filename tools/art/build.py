"""Builds the interface art for Skyrise into assets/ui/ from the free packs fetch.sh downloads.

Run from the repo root:  bash tools/art/fetch.sh && python3 tools/art/build.py   (needs Pillow and fonttools)

  assets/ui/tools/<tool>.png|svg   toolbar icons. Rooms and services are Kenney's Generic Items
                                   (CC0); the structural tools Kenney has no item for (lobby,
                                   floor, stairs, lifts, escalator, Sky Garden, inspect) are drawn
                                   here as SVG in the same flat two-tone style.
  assets/ui/glyphs/<name>.png      one-colour glyphs (Kenney Game Icons, Board Game Icons), used as
                                   CSS masks so they take the theme's text colour.
  assets/ui/star-on.png, star-off.png   the rating stars (Kenney UI Pack).
  assets/ui/font/kenney-future-narrow.woff   Kenney Future Narrow, Latin subset.
  assets/ui/app-icon.svg, app-icon-512.png, app-icon-180.png   the app icon, drawn here (PNGs
                                   rendered by tools/art/icon.mjs with the pre-installed Chromium).
  assets/ui/manifest.json, LICENSE.md   every file, its source and licence.

Every pick is a line in the tables below; changing an icon is a one-line edit and a re-run.
"""
import json
import os
import subprocess

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, 'cache')
OUT = os.path.join(ROOT, 'assets', 'ui')
SOURCES = json.load(open(os.path.join(HERE, 'sources.json')))['packs']
ICON_PX = 96          # toolbar icons: shown at 32 CSS px, sharp up to 3x screens
GLYPH_PX = 64

GENERIC = 'PNG/Colored/genericItem_color_%03d.png'
# Toolbar icons from Kenney's Generic Items (number on its contact sheet).
ITEMS = {
    'office': 141,        # briefcase
    'shop': 144,          # handbag
    'flat': 154,          # house keys
    'hotel': 152,         # desk bell
    'housekeeping': 153,  # door hanger
    'food': 116,          # frying pan
    'security': 150,      # ID badge
    'clinic': 102,        # first-aid kit
    'plant': 8,           # pipe wrench
    'parking': 147,       # steering wheel
    'transit': 149,       # ticket
    'hall': 83,           # microphone
    'dig': 21,            # pickaxe
    'demolish': 23,       # mallet
}

# One-colour glyphs: (pack, path inside the pack).
GLYPHS = {
    'coin': ('kenney-game-icons-expansion', 'PNG/White/2x/coin.png'),
    'person': ('kenney-board-game-icons', 'PNG/Double (128px)/pawn.png'),
    'lock': ('kenney-board-game-icons', 'PNG/Double (128px)/lock_closed.png'),
    'crown': ('kenney-board-game-icons', 'PNG/Double (128px)/crown_a.png'),
    'save': ('kenney-game-icons', 'PNG/White/2x/save.png'),
    'home': ('kenney-game-icons', 'PNG/White/2x/home.png'),
    'trophy': ('kenney-game-icons', 'PNG/White/2x/trophy.png'),
    'slots': ('kenney-game-icons', 'PNG/White/2x/menuList.png'),
    'pause': ('kenney-game-icons', 'PNG/White/2x/pause.png'),
    'play': ('kenney-game-icons', 'PNG/White/2x/right.png'),
    'contrast': ('kenney-game-icons', 'PNG/White/2x/contrast.png'),
    'audio-on': ('kenney-game-icons', 'PNG/White/2x/audioOn.png'),
    'audio-off': ('kenney-game-icons', 'PNG/White/2x/audioOff.png'),
    'target': ('kenney-game-icons', 'PNG/White/2x/target.png'),
    'plus': ('kenney-game-icons', 'PNG/White/2x/plus.png'),
    'menu': ('kenney-game-icons', 'PNG/White/2x/menuGrid.png'),
    'cross': ('kenney-game-icons', 'PNG/White/2x/cross.png'),
    'checkmark': ('kenney-game-icons', 'PNG/White/2x/checkmark.png'),
    'warning': ('kenney-game-icons', 'PNG/White/2x/warning.png'),
    'chevron': ('kenney-game-icons', 'PNG/White/2x/down.png'),
}
STARS = {
    'star-on': ('kenney-ui-pack', 'PNG/Yellow/Double/star.png'),
    'star-off': ('kenney-ui-pack', 'PNG/Grey/Double/star_outline_depth.png'),
}
FONT = ('kenney-ui-pack', 'Font/Kenney Future Narrow.ttf')

# Hand-drawn icons in Kenney's flat style: a light face and a darker side, no outlines.
INK, STEEL, STEEL_D, LIGHT = '#3d4452', '#a9b4c2', '#7d8a9b', '#e6ebf0'
BLUE, BLUE_D, ORANGE, ORANGE_D = '#4a90d9', '#2f6fb3', '#e8613c', '#c24a2a'
YELLOW, YELLOW_D, BROWN, BROWN_D = '#fbd24a', '#e0a92a', '#a0643c', '#7a4a2a'
GREEN, GREEN_D, CREAM, NAVY = '#5cb85c', '#3d8b40', '#f2e3c4', '#2c3e66'


def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">{body}</svg>\n'


def lift_doors(frame, frame_d, door, door_d, extra=''):
    return (f'<rect x="12" y="10" width="40" height="48" rx="3" fill="{frame_d}"/>'
            f'<rect x="12" y="10" width="38" height="46" rx="3" fill="{frame}"/>'
            f'<rect x="17" y="20" width="14" height="32" fill="{door}"/><rect x="33" y="20" width="14" height="32" fill="{door}"/>'
            f'<rect x="28" y="20" width="3" height="32" fill="{door_d}"/><rect x="44" y="20" width="3" height="32" fill="{door_d}"/>'
            f'<path d="M26 17l3-4 3 4z" fill="{YELLOW}"/><path d="M33 13l3 4 3-4z" fill="{LIGHT}"/>' + extra)


DRAWN = {
    'lobby': svg(
        f'<rect x="8" y="22" width="48" height="36" rx="2" fill="{CREAM}"/><rect x="50" y="22" width="6" height="36" fill="#d9c49c"/>'
        f'<rect x="22" y="32" width="20" height="26" fill="{BROWN}"/><rect x="38" y="32" width="4" height="26" fill="{BROWN_D}"/>'
        f'<rect x="25" y="35" width="6" height="18" fill="#9fd0f2"/><rect x="33" y="35" width="6" height="18" fill="#9fd0f2"/>'
        f'<path d="M4 22l6-12h44l6 12z" fill="{ORANGE}"/><path d="M14 10h8l-3 12h-8zM30 10h8l-1 12h-8zM46 10h8l3 12h-8z" fill="{LIGHT}"/>'
        f'<rect x="11" y="36" width="8" height="10" fill="#9fd0f2"/><rect x="45" y="36" width="8" height="10" fill="#9fd0f2"/>'),
    'floor': svg(
        f'<path d="M6 28h52v8H6z" fill="{ORANGE}"/><path d="M6 36h52v4H6z" fill="{ORANGE_D}"/>'
        f'<path d="M10 40h6v14h-6zM29 40h6v14h-6zM48 40h6v14h-6z" fill="{STEEL}"/><path d="M14 40h2v14h-2zM33 40h2v14h-2zM52 40h2v14h-2z" fill="{STEEL_D}"/>'
        f'<circle cx="14" cy="32" r="1.6" fill="{ORANGE_D}"/><circle cx="32" cy="32" r="1.6" fill="{ORANGE_D}"/><circle cx="50" cy="32" r="1.6" fill="{ORANGE_D}"/>'
        f'<path d="M6 20h52v4H6z" fill="{STEEL}"/>'),
    'stairs': svg(
        f'<path d="M8 56V46h12V36h12V26h12V16h12v40z" fill="{STEEL}"/>'
        f'<path d="M8 46h12v3H8zM20 36h12v3H20zM32 26h12v3H32zM44 16h12v3H44z" fill="{YELLOW}"/>'
        f'<path d="M52 16h4v40h-4z" fill="{STEEL_D}"/>'),
    'elevator': svg(lift_doors(STEEL, STEEL_D, BLUE, BLUE_D)),
    'car': svg(lift_doors(STEEL, STEEL_D, BLUE, BLUE_D,
        f'<circle cx="48" cy="46" r="12" fill="{GREEN_D}"/><circle cx="47" cy="45" r="11" fill="{GREEN}"/>'
        f'<path d="M44.5 38h5v14h-5z" fill="#fff"/><path d="M40 42.5h14v5H40z" fill="#fff"/>')),
    'express': svg(lift_doors(NAVY, '#1d2a48', YELLOW, YELLOW_D,
        f'<path d="M36 26l-9 13h6l-3 11 10-15h-6l3-9z" fill="{NAVY}"/>')),
    'servicelift': svg(lift_doors('#8a7a55', '#665a3e', '#c9b483', '#a89464',
        f'<rect x="22" y="38" width="20" height="14" rx="1" fill="{BROWN}"/><rect x="22" y="38" width="20" height="3" fill="{BROWN_D}"/>'
        f'<path d="M31 41h2v11h-2z" fill="{BROWN_D}"/>')),
    'escalator': svg(
        f'<path d="M6 54l36-36h16v8H46L14 58H6z" fill="{STEEL}"/><path d="M14 58l32-32h12v4H48L18 58z" fill="{STEEL_D}"/>'
        f'<path d="M16 46l4 4M23 39l4 4M30 32l4 4M37 25l4 4" stroke="{INK}" stroke-width="2.5" stroke-linecap="round"/>'
        f'<path d="M4 46l32-32h20" stroke="{ORANGE}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
    'landmark': svg(
        f'<rect x="8" y="46" width="48" height="12" rx="2" fill="{STEEL}"/><rect x="8" y="54" width="48" height="4" fill="{STEEL_D}"/>'
        f'<rect x="29" y="34" width="6" height="14" fill="{BROWN}"/><rect x="32" y="34" width="3" height="14" fill="{BROWN_D}"/>'
        f'<circle cx="32" cy="24" r="16" fill="{GREEN}"/><path d="M32 8a16 16 0 0 1 0 32z" fill="{GREEN_D}" opacity="0.55"/>'
        f'<circle cx="16" cy="42" r="7" fill="{GREEN}"/><circle cx="48" cy="42" r="7" fill="{GREEN_D}"/>'
        f'<path d="M32 4l2.4 5 5.4.6-4 3.7 1.1 5.3-4.9-2.7-4.9 2.7 1.1-5.3-4-3.7 5.4-.6z" fill="{YELLOW}"/>'),
    'inspect': svg(
        f'<path d="M37 41l6-6 15 15a4 4 0 0 1-6 6z" fill="{BROWN}"/><path d="M40 38l3-3 15 15a4 4 0 0 1-3 3z" fill="{BROWN_D}"/>'
        f'<circle cx="26" cy="26" r="18" fill="{STEEL_D}"/><circle cx="26" cy="26" r="13" fill="#9fd0f2"/>'
        f'<path d="M18 20a10 10 0 0 1 8-6" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/>'),
}


# The app icon: a stepped tower with lit windows against a morning sky, a sun and a cloud.
APP_ICON = svg(
    '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d8bfd"/>'
    '<stop offset="1" stop-color="#bfe0ff"/></linearGradient><clipPath id="c"><rect width="64" height="64" rx="14"/></clipPath></defs>'
    '<g clip-path="url(#c)"><rect width="64" height="64" fill="url(#s)"/>'
    f'<circle cx="47" cy="15" r="7" fill="{YELLOW}"/><circle cx="47" cy="15" r="11" fill="{YELLOW}" opacity="0.25"/>'
    '<path d="M8 22a5 5 0 0 1 9-3 4 4 0 0 1 7 2 3.5 3.5 0 0 1 0 7H10a3 3 0 0 1-2-6z" fill="#fff" opacity="0.9"/>'
    f'<rect x="0" y="54" width="64" height="10" fill="{GREEN_D}"/><path d="M0 54h64v2H0z" fill="{GREEN}"/>'
    f'<rect x="18" y="30" width="28" height="25" fill="{STEEL}"/><rect x="40" y="30" width="6" height="25" fill="{STEEL_D}"/>'
    f'<rect x="23" y="18" width="18" height="13" fill="{STEEL}"/><rect x="36" y="18" width="5" height="13" fill="{STEEL_D}"/>'
    f'<rect x="28" y="8" width="8" height="11" fill="{STEEL}"/><rect x="33" y="8" width="3" height="11" fill="{STEEL_D}"/>'
    f'<rect x="31" y="3" width="1.6" height="6" fill="{INK}"/>'
    + ''.join(f'<rect x="{21 + c * 6}" y="{33 + r * 6}" width="3.5" height="3.5" fill="{YELLOW if (r + c) % 3 else "#9fd0f2"}"/>'
              for r in range(3) for c in range(4))
    + ''.join(f'<rect x="{26 + c * 6}" y="{21 + r * 5}" width="3.5" height="3" fill="{YELLOW if (r + c) % 2 else "#9fd0f2"}"/>'
              for r in range(2) for c in range(2))
    + f'<rect x="30" y="11" width="4" height="4" fill="{YELLOW}"/>'
    + f'<rect x="28" y="49" width="8" height="6" fill="{BROWN}"/><rect x="16" y="53" width="32" height="2" fill="{INK}" opacity="0.35"/></g>')


def fit(im, px, pad=0.06):
    """Trim transparent edges and centre on a px square, keeping the aspect."""
    im = im.convert('RGBA')
    box = im.getbbox()
    if box:
        im = im.crop(box)
    inner = int(px * (1 - 2 * pad))
    scale = min(inner / im.width, inner / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    out = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    out.paste(im, ((px - im.width) // 2, (px - im.height) // 2), im)
    return out


def src(pack, path):
    p = os.path.join(CACHE, pack, path)
    if not os.path.exists(p):
        raise SystemExit(f'missing {pack}/{path}: run tools/art/fetch.sh')
    return p


def main():
    for d in ('tools', 'glyphs', 'font'):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    files = {}

    def note(rel, pack, frm, extra=None):
        s = SOURCES[pack] if pack else None
        files[rel] = {'from': frm, 'title': s['title'] if s else 'Skyrise', 'author': s['author'] if s else 'Skyrise (tools/art/build.py)',
                      'licence': s['licence'] if s else 'original', 'page': s['page'] if s else None,
                      'bytes': os.path.getsize(os.path.join(OUT, rel)), **(extra or {})}

    for tool, n in ITEMS.items():
        rel = f'tools/{tool}.png'
        fit(Image.open(src('kenney-generic-items', GENERIC % n)), ICON_PX).save(os.path.join(OUT, rel), optimize=True)
        note(rel, 'kenney-generic-items', os.path.basename(GENERIC % n))
    for tool, body in DRAWN.items():
        rel = f'tools/{tool}.svg'
        open(os.path.join(OUT, rel), 'w').write(body)
        note(rel, None, 'drawn in tools/art/build.py')
    for name, (pack, path) in GLYPHS.items():
        rel = f'glyphs/{name}.png'
        im = fit(Image.open(src(pack, path)), GLYPH_PX, pad=0.04)
        # Masks only need alpha: store white on transparent.
        a = im.getchannel('A')
        white = Image.new('RGBA', im.size, (255, 255, 255, 0)); white.putalpha(a)
        white.save(os.path.join(OUT, rel), optimize=True)
        note(rel, pack, path)
    for name, (pack, path) in STARS.items():
        rel = f'{name}.png'
        fit(Image.open(src(pack, path)), GLYPH_PX, pad=0.02).save(os.path.join(OUT, rel), optimize=True)
        note(rel, pack, path)

    # The font: Latin-1 plus the punctuation the game uses, as WOFF (zlib; WOFF2 would need brotli).
    from fontTools import subset
    from fontTools.ttLib import TTFont
    rel = 'font/kenney-future-narrow.woff'
    font = TTFont(src(*FONT))
    opts = subset.Options(); opts.flavor = 'woff'; opts.layout_features = ['*']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [0x2013, 0x2014, 0x2019, 0x2026, 0x00D7])
    sub.subset(font)
    font.flavor = 'woff'
    font.save(os.path.join(OUT, rel))
    note(rel, FONT[0], FONT[1])

    # The app icon: the SVG, and PNGs rendered from it.
    open(os.path.join(OUT, 'app-icon.svg'), 'w').write(APP_ICON)
    note('app-icon.svg', None, 'drawn in tools/art/build.py')
    subprocess.run(['node', os.path.join(HERE, 'icon.mjs')], check=True)
    for px in (512, 180):
        note(f'app-icon-{px}.png', None, 'rendered from app-icon.svg by tools/art/icon.mjs')

    # Drop files from earlier builds that are no longer picked.
    keep = set(files)
    for d in ('tools', 'glyphs', 'font', ''):
        for f in os.listdir(os.path.join(OUT, d)):
            rel = os.path.join(d, f) if d else f
            if os.path.isfile(os.path.join(OUT, rel)) and rel not in keep and f not in ('manifest.json', 'LICENSE.md'):
                os.remove(os.path.join(OUT, rel)); print('removed', rel)

    manifest = {'note': 'Generated by tools/art/build.py. Every interface file, with its source and licence.',
                'tools': sorted(set(os.path.splitext(os.path.basename(f))[0] for f in files if f.startswith('tools/'))),
                'glyphs': sorted(GLYPHS), 'files': files}
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=2)
    open(os.path.join(OUT, 'manifest.json'), 'a').write('\n')

    by = {}
    for rel, m in sorted(files.items()):
        by.setdefault((m['author'], m['page'] or '', m['licence'], m['title']), []).append(rel)
    lines = ['# Skyrise interface art (assets/ui/)', '',
             'Generated by `tools/art/build.py` from free packs (sources and checksums in `tools/art/sources.json`).',
             'CC0 files need no credit; they are listed anyway, with thanks. The drawn icons are original.', '',
             '| Files | Source | Author | Licence |', '|---|---|---|---|']
    for (author, page, licence, title), rels in sorted(by.items()):
        lines.append(f"| {', '.join(rels)} | {f'[{title}]({page})' if page else title} | {author} | {licence} |")
    open(os.path.join(OUT, 'LICENSE.md'), 'w').write('\n'.join(lines) + '\n')
    total = sum(m['bytes'] for m in files.values())
    print(f'wrote {len(files)} files, {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()
