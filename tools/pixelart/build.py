"""Skyrise pixel art: every sprite and the pixel font, drawn in code from one palette.

Writes godot/assets/pixel/:
  atlas.png + atlas.json   every sprite packed into one texture (name -> [x, y, w, h]),
                           so the game draws the whole tower from one texture in a few batches.
  font.png + font.json     a proportional 5x7 pixel font (cap height 7, descenders 2).
  preview.png              every sprite at 4x with its name, for reviewing the art.

The art grid: a room cell is 12x16 art pixels (a floor is 16 tall, the bottom two rows are
its slab). The game shows art pixels at an integer zoom (2 by default), so every pixel stays
square and crisp. Room facades come in the businesses of sim/tenants.gd. Windows that light
up at night are a separate overlay sprite (<name>.lit), faded in by the game as dusk falls.

Run from the repo root:  python3 tools/pixelart/build.py
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'godot', 'assets', 'pixel')
CW, CH = 12, 16                       # one cell, in art pixels

# ---- Palette: original, 48 colours ------------------------------------------------
PAL = {
    'ink': '#141420', 'shadow': '#23263a', 'slate': '#3a4256', 'steel': '#5b6679', 'grey': '#8a94a3',
    'silver': '#b8c0cc', 'light': '#dde3ea', 'white': '#f6f7f9',
    'brick_dk': '#5c2e2e', 'brick': '#8a4242', 'terra': '#b35a3c', 'orange': '#e07a3a', 'amber': '#f2a541',
    'yellow': '#f7d154', 'cream': '#f3e4bd', 'beige': '#e2cfa0',
    'forest': '#2e5e3e', 'green': '#3f8f4e', 'leaf': '#6bbf59', 'mint': '#a8dfb0', 'sage': '#b9d3b0',
    'navy': '#1f2d4f', 'blue': '#2f5d9e', 'sky': '#4f8fd6', 'ice': '#a9cfe8', 'glass': '#7fa8c9', 'glass_dk': '#2c3a5a',
    'plum': '#4e3462', 'purple': '#7c4dbd', 'lavender': '#cdb4e0', 'rose': '#d4588f', 'pink': '#f2a7bf',
    'wood_dk': '#4a3020', 'wood': '#7a5230', 'tan': '#b8875a', 'sand': '#e0c08a',
    'red': '#c83a3a', 'wine': '#8e2236', 'teal': '#2a9d8f', 'teal_lt': '#8fd3c8',
    'skin1': '#f2c9a0', 'skin2': '#c98e5a', 'skin3': '#8a5a3a',
    'hair1': '#2a1e1a', 'hair2': '#6b4226', 'hair3': '#e0b45a',
    'lit': '#ffd36b', 'lit_hi': '#fff2b0', 'office': '#a9bdd6', 'office_dk': '#7f93ad',
}
RGB = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in PAL.items()}
T = (0, 0, 0, 0)


def c(name, a=255):
    return RGB[name] + (a,)


class Sprite:
    def __init__(self, w, h):
        self.a = np.zeros((h, w, 4), np.uint8)
        self.w, self.h = w, h

    def px(self, x, y, col):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = col if len(col) == 4 else col + (255,)

    def rect(self, x, y, w, h, col):
        x0, y0, x1, y1 = max(0, x), max(0, y), min(self.w, x + w), min(self.h, y + h)
        if x1 > x0 and y1 > y0:
            self.a[y0:y1, x0:x1] = col if len(col) == 4 else col + (255,)

    def hline(self, x, y, w, col):
        self.rect(x, y, w, 1, col)

    def vline(self, x, y, h, col):
        self.rect(x, y, 1, h, col)

    def ascii(self, x, y, rows, key):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in key:
                    self.px(x + i, y + j, key[ch])

    def dither(self, x, y, w, h, col_a, col_b):
        for j in range(h):
            for i in range(w):
                self.px(x + i, y + j, col_a if (i + j) % 2 == 0 else col_b)

    def copy(self):
        s = Sprite(self.w, self.h)
        s.a = self.a.copy()
        return s


SPRITES = {}


def add(name, sprite):
    SPRITES[name] = sprite


# ---- Shared room parts ---------------------------------------------------------------

def shell(w_cells, wall, h_cells=1, trim='slate'):
    """A room box: wall, a light ceiling line, the dark floor slab and an outline."""
    s = Sprite(w_cells * CW, h_cells * CH)
    s.rect(0, 0, s.w, s.h, c(wall))
    s.hline(0, 0, s.w, c('white', 90))
    for f in range(h_cells):
        y = f * CH
        s.rect(0, y + CH - 2, s.w, 2, c('shadow'))
        s.hline(0, y + CH - 2, s.w, c(trim))
    s.vline(0, 0, s.h, c('ink', 70))
    s.vline(s.w - 1, 0, s.h, c('ink', 110))
    return s


def lit_overlay(src, regions):
    """The night overlay: the given window rects, in warm light."""
    s = Sprite(src.w, src.h)
    for x, y, w, h in regions:
        s.rect(x, y, w, h, c('lit'))
        s.hline(x, y, w, c('lit_hi'))
    return s


def window(s, x, y, w, h, frame='slate', glass='glass'):
    s.rect(x - 1, y - 1, w + 2, h + 2, c(frame))
    s.rect(x, y, w, h, c(glass))
    s.px(x, y, c('ice'))                                 # a glint in the corner
    return (x, y, w, h)


# ---- Rooms -------------------------------------------------------------------------------

OFFICE_BIZ = [('tech', 'teal'), ('law', 'wood'), ('bank', 'amber'), ('design', 'orange')]
SHOP_BIZ = [('sushi', 'terra', 'noren'), ('italian', 'green', 'stripe'), ('indian', 'forest', 'flat'), ('noodle', 'red', 'noren'),
            ('kopitiam', 'wood', 'stripe'), ('gym', 'blue', 'flat'), ('florist', 'rose', 'stripe'), ('books', 'purple', 'none')]
FLAT_BIZ = [('plant', 'green', 'mint'), ('bike', 'blue', 'ice'), ('laundry', 'rose', 'pink'), ('plain', 'amber', 'cream')]
FOOD_BIZ = [('hawker', 'red'), ('kopi', 'wood'), ('pizza', 'green')]
HOTEL_BIZ = [('classic', 'amber', 'sand'), ('garden', 'teal', 'teal_lt')]
HALL_BIZ = [('velvet', 'wine'), ('royal', 'navy')]

GLYPHS = {  # 3x3 sign glyphs
    'tech': ['x.x', '.x.', 'x.x'], 'law': ['xxx', '.x.', 'x.x'], 'bank': ['.x.', 'xxx', '.x.'], 'design': ['..x', '.x.', 'x..'],
}


def office(biz, accent):
    s = shell(3, 'office')
    wins = []
    for i in range(6):                                   # two tall windows per cell
        x = 2 + i * 6
        wins.append(window(s, x, 3, 3, 6, frame='office_dk', glass='glass'))
    s.rect(1, 11, 34, 1, c('office_dk'))                 # desks under the windows
    for i in range(6):
        x = 2 + i * 6
        s.rect(x, 10, 2, 1, c('ink'))                    # a monitor on each desk
        s.px(x + 3, 12, c('steel'))                      # a chair
    s.rect(29, 2, 5, 1, c(accent))                       # the firm's colour band
    g = GLYPHS[biz]
    s.rect(1, 12, 5, 1, c('office_dk'))
    s.ascii(31, 10, [r.replace('x', 'a') for r in g][:2], {'a': c(accent)})
    lit = lit_overlay(s, [(x, y, w, h) for x, y, w, h in wins] + [(2 + i * 6, 10, 2, 1) for i in range(6)])
    return s, lit


def shop(biz, accent, awning):
    s = shell(2, 'cream')
    glass = window(s, 2, 6, 13, 6, frame='steel')
    s.rect(17, 6, 5, 8, c('wood'))                       # the door
    s.rect(18, 7, 3, 4, c('glass'))
    s.px(20, 10, c('yellow'))
    for i, col in enumerate(['red', 'amber', 'leaf', accent, 'pink', 'sky']):
        s.rect(3 + i * 2, 10, 1, 2, c(col))              # goods in the window
    if awning == 'stripe':
        for i in range(24):
            s.rect(i, 1, 1, 3, c(accent) if (i // 2) % 2 == 0 else c('white'))
        for i in range(0, 24, 2):
            s.px(i, 4, c(accent))                        # a scalloped edge
    elif awning == 'flat':
        s.rect(0, 1, 24, 3, c(accent))
        s.hline(0, 3, 24, c('ink', 90))
    elif awning == 'noren':
        s.hline(1, 1, 22, c('wood_dk'))
        for i in range(4):
            s.rect(2 + i * 5, 2, 4, 4, c(accent))
            s.px(3 + i * 5, 3, c('white'))
    else:
        s.rect(2, 1, 20, 3, c('wood_dk'))
        s.rect(3, 2, 18, 1, c(accent))
    lit = lit_overlay(s, [glass, (18, 7, 3, 4)])
    return s, lit


def flat(biz, accent, curtain):
    s = shell(2, 'beige')
    w1 = window(s, 2, 3, 6, 6, frame='tan')
    w2 = window(s, 15, 3, 6, 6, frame='tan')
    for x in (2, 15):
        s.vline(x, 3, 6, c(curtain))
        s.vline(x + 5, 3, 6, c(curtain))
    s.hline(1, 10, 22, c('slate'))                       # the balcony rail
    for x in range(1, 23, 2):
        s.vline(x, 11, 2, c('slate'))
    if biz == 'plant':
        s.rect(10, 9, 3, 1, c('terra'))
        s.ascii(9, 6, ['.g.', 'ggg', 'g.g'], {'g': c('green')})
    elif biz == 'bike':
        s.ascii(9, 7, ['.x...x', 'x.x.x.x', '.x...x'], {'x': c(accent)})
    elif biz == 'laundry':
        s.hline(9, 2, 6, c('steel'))
        for i, col in enumerate([accent, 'white', 'sky']):
            s.rect(9 + i * 2, 3, 1, 2 + i % 2, c(col))
    lit = lit_overlay(s, [(w1[0] + 1, w1[1], 4, 6), (w2[0] + 1, w2[1], 4, 6)])
    return s, lit


def food(biz, accent):
    s = shell(3, 'sand')
    counter = window(s, 2, 2, 32, 4, frame='wood', glass='cream')
    for i in range(0, 32, 4):
        s.rect(3 + i, 3, 2, 2, c(['red', 'amber', 'leaf', 'orange'][(i // 4) % 4]))   # dishes on the counter
    s.hline(1, 7, 34, c(accent))
    for i in range(3):
        x = 5 + i * 11
        s.rect(x, 10, 6, 1, c('wood_dk'))                # a table
        s.vline(x + 2, 11, 3, c('wood_dk'))
        s.px(x - 1, 12, c('steel'))
        s.px(x + 6, 12, c('steel'))
    lit = lit_overlay(s, [(2, 2, 32, 1)])
    return s, lit


def hotel(biz, accent, spread, dirty=False):
    s = shell(2, 'lavender')
    w = window(s, 2, 3, 6, 6, frame='plum')
    s.rect(12, 8, 2, 5, c('wood_dk'))                    # the headboard
    s.rect(14, 10, 9, 3, c(spread))                      # the bed
    s.rect(14, 10, 2, 1, c('white'))                     # the pillow
    s.px(12, 7, c(accent))
    if dirty:
        s.ascii(15, 9, ['.ww.w', 'w..ww'], {'w': c('white')})
        s.rect(4, 11, 2, 2, c('wood', 200))              # a stain on the floor
    lit = lit_overlay(s, [w])
    return s, lit


def hall(biz, accent):
    s = shell(4, 'pink')
    stage = window(s, 12, 2, 24, 7, frame='wood_dk', glass='wood')
    s.rect(9, 1, 3, 10, c(accent))
    s.rect(36, 1, 3, 10, c(accent))
    for i in range(16):
        s.rect(3 + i * 3, 11, 2, 2, c('wine' if biz == 'velvet' else 'navy'))   # seats
    lit = lit_overlay(s, [(12, 2, 24, 7)])
    return s, lit


def service(kind):
    walls = {'security': 'ice', 'housekeeping': 'mint', 'clinic': 'white', 'plant': 'sage'}
    w = 3 if kind == 'plant' else 2
    s = shell(w, walls[kind])
    win = window(s, 2, 3, 8, 7, frame='steel')
    bx = s.w - 8
    if kind == 'security':
        s.ascii(bx, 4, ['bbbbb', 'bybyb', 'bbbbb', '.bbb.', '..b..'], {'b': c('blue'), 'y': c('yellow')})
    elif kind == 'housekeeping':
        s.ascii(bx, 5, ['.....m', 'sssss.', '.sss.m', '.sss.m', '..s..m'], {'s': c('sky'), 'm': c('wood')})
    elif kind == 'clinic':
        s.ascii(bx, 4, ['.rr.', 'rrrr', 'rrrr', '.rr.'], {'r': c('red')})
    else:
        s.rect(13, 6, 16, 1, c('steel'))                 # pipes to a pump
        s.ascii(bx, 4, ['.ss.', 'sggs', 'sggs', '.ss.'], {'s': c('steel'), 'g': c('green')})
    return s, lit_overlay(s, [win])


def parking():
    s = shell(4, 'grey')
    s.rect(1, 12, 46, 2, c('slate'))
    for i in range(1, 6):
        s.vline(i * 8, 8, 6, c('yellow'))                # bay lines
    s.rect(1, 2, 46, 1, c('steel'))
    for i in range(6):
        s.px(4 + i * 8, 3, c('lit'))                     # ceiling lamps
    return s, lit_overlay(s, [(4 + i * 8, 3, 1, 1) for i in range(6)])


def transit():
    s = shell(6, 'slate')
    s.rect(1, 12, 70, 2, c('ink'))
    for x in range(0, 72, 3):
        s.px(x, 12, c('steel'))                          # sleepers
    s.rect(6, 4, 54, 8, c('silver'))                     # the train
    s.rect(6, 4, 54, 1, c('white'))
    s.rect(6, 9, 54, 1, c('teal'))
    wins = []
    for i in range(8):
        wins.append((9 + i * 6, 5, 4, 3))
        s.rect(9 + i * 6, 5, 4, 3, c('glass_dk'))
    s.ascii(60, 4, ['ss.', 'sss', 'sss', 'sss', 'sss', 'sss', 'sss', 'ss.'], {'s': c('silver')})
    return s, lit_overlay(s, wins)


def lobby(variant):
    s = shell(1, 'cream')
    s.rect(0, 1, 12, 3, c('tan'))                        # the canopy
    s.hline(0, 3, 12, c('wood_dk'))
    win = (1, 5, 10, 8)
    s.rect(1, 5, 10, 8, c('glass'))
    s.vline(6, 5, 8, c('slate'))                         # the door split
    s.rect(1, 5, 10, 1, c('ice'))
    if variant == 1:
        s.px(3, 9, c('slate'))
        s.px(8, 9, c('slate'))                           # door handles
    else:
        s.ascii(2, 9, ['.g.', 'ggg', '.w.'], {'g': c('green'), 'w': c('wood')})     # a pot plant
    return s, lit_overlay(s, [win])


def stairs():
    s = shell(1, 'steel', h_cells=2)
    for i in range(5):                                   # two flights with a landing
        s.rect(1 + i * 2, 29 - i * 2 - 2, 10 - i * 2, 2, c('silver'))
        s.rect(1, 13 - i * 2, 2 + i * 2, 2, c('silver'))
    s.hline(1, 15, 10, c('slate'))
    s.vline(1, 2, 12, c('ink', 120))
    return s, None


def escalator():
    s = shell(2, 'grey', h_cells=2)
    for i in range(18):
        x, y = 3 + i, 28 - int(i * 0.8 * 1.1)
        s.rect(x, y, 2, 2, c('silver'))
        s.px(x, y + 2, c('ink', 160))
    s.hline(2, 15, 6, c('slate'))
    return s, None


def shaft(kind):
    base = {'elevator': 'slate', 'express': 'navy', 'servicelift': 'wood_dk'}[kind]
    s = Sprite(CW, CH)
    s.rect(0, 0, CW, CH, c(base))
    s.vline(2, 0, CH, c('steel'))
    s.vline(9, 0, CH, c('steel'))                        # guide rails
    s.hline(0, CH - 1, CW, c('ink'))
    if kind == 'express':
        s.ascii(3, 5, ['..x...', '.x.x..', 'x...x.', '..x...', '.x.x..', 'x...x.'], {'x': c('ice')})
    if kind == 'servicelift':
        for y in (4, 8, 12):
            for x in range(1, 11):
                s.px(x, y, c('amber') if (x // 2) % 2 == 0 else c('ink'))
    add(f'shaft.{kind}', s)
    closed = Sprite(CW, CH)
    closed.rect(1, 7, 10, 2, c('red'))
    closed.rect(1, 7, 10, 1, c('pink'))
    add('shaft.closed', closed)


def slab():
    s = Sprite(CW, CH)
    s.rect(0, CH - 2, CW, 2, c('steel'))
    for x in range(0, CW, 2):
        s.px(x, 0, c('steel'))
        s.px(x, CH - 3, c('steel'))
    for y in range(0, CH - 2, 2):
        s.px(0, y, c('steel'))
        s.px(CW - 1, y, c('steel'))
    return s


def landmark():
    src = Image.open(os.path.join(ROOT, 'assets', 'art', 'landmark-rooftop.png')).convert('RGBA')
    w, h = 12 * CW, 6 * CH
    small = src.resize((w, h), Image.LANCZOS)
    pal_img = Image.new('P', (1, 1))
    flat_pal = []
    for v in RGB.values():
        flat_pal += list(v)
    pal_img.putpalette(flat_pal + [0] * (768 - len(flat_pal)))
    q = small.convert('RGB').quantize(palette=pal_img, dither=Image.Dither.NONE).convert('RGBA')
    arr = np.array(q)
    arr[..., 3] = np.where(np.array(small)[..., 3] > 100, 255, 0)
    s = Sprite(w, h)
    s.a = arr.astype(np.uint8)
    return s


# ---- People, lifts and life ---------------------------------------------------------------

PERSON = [  # 5x9: h hair, s skin, x shirt (mask), l legs, f feet
    ['.hhh.', '.sss.', '.sss.', 'xxxxx', 'xxxxx', '.xxx.', '.l.l.', '.l.l.', '.f.f.'],
    ['.hhh.', '.sss.', '.sss.', 'xxxxx', 'xxxxx', '.xxx.', '.l..l', 'l...l', 'f....'],
    ['.hhh.', '.sss.', '.sss.', 'xxxxx', 'xxxxx', '.xxx.', 'l..l.', 'l...l', '....f'],
]


def people():
    for si, skin in enumerate(['skin1', 'skin2', 'skin3']):
        for hi, hair in enumerate(['hair1', 'hair2', 'hair3']):
            for fi, rows in enumerate(PERSON):
                s = Sprite(5, 9)
                s.ascii(0, 0, rows, {'h': c(hair), 's': c(skin), 'l': c('navy'), 'f': c('ink')})
                add(f'person.{si}{hi}.{fi}', s)
    for fi, rows in enumerate(PERSON):
        m = Sprite(5, 9)
        m.ascii(0, 0, rows, {'x': c('white')})
        add(f'person.shirt.{fi}', m)
    head = Sprite(3, 3)
    head.ascii(0, 0, ['hhh', 'sss', 'sss'], {'h': c('hair1'), 's': c('skin1')})
    add('rider', head)


def lift_car():
    for k in range(4):                                   # doors 0 = shut .. 3 = open
        s = Sprite(10, 14)
        s.rect(0, 0, 10, 14, c('amber'))
        s.rect(0, 0, 10, 1, c('yellow'))
        s.rect(0, 13, 10, 1, c('wood'))
        s.rect(1, 2, 8, 10, c('lit'))
        gap = k
        s.rect(1, 2, 4 - gap, 10, c('terra'))
        s.rect(5 + gap, 2, 4 - gap, 10, c('terra'))
        s.vline(4 - gap, 2, 10, c('wood'))
        s.vline(5 + gap, 2, 10, c('wood'))
        add(f'car.{k}', s)


def faces():
    for band, col in (('good', 'leaf'), ('fair', 'amber'), ('poor', 'red')):
        s = Sprite(7, 7)
        s.ascii(0, 0, ['.ooooo.', 'ooooooo', 'oeoooeo', 'ooooooo', 'ooooooo', 'ooooooo', '.ooooo.'], {'o': c(col), 'e': c('ink')})
        mouth = {'good': ['m...m', '.mmm.'], 'fair': ['.....', 'mmmmm'], 'poor': ['.mmm.', 'm...m']}[band]
        s.ascii(1, 4, mouth, {'m': c('ink')})
        add(f'face.{band}', s)
    drop = Sprite(2, 3)
    drop.ascii(0, 0, ['.b', 'bb', 'bb'], {'b': c('sky')})
    add('sweat', drop)


def fire():
    frames = [
        ['...y....', '..yoy...', '..yooy..', '.yooroy.', '.yorrroy', 'yorrrroy', 'yorrrrry', '.yyyyyy.'],
        ['....y...', '...yoy..', '..yooy..', '.yoorry.', 'yoorrroy', 'yorrrroy', 'yorrrrry', '.yyyyyy.'],
        ['..y..y..', '..yoyoy.', '.yooooy.', '.yorrroy', 'yorrrroy', 'yorrrrry', 'yorrrrry', '.yyyyyy.'],
    ]
    for i, f in enumerate(frames):
        s = Sprite(8, 8)
        s.ascii(0, 0, f, {'y': c('yellow'), 'o': c('orange'), 'r': c('red')})
        add(f'fire.{i}', s)
    for r in (2, 3, 4):
        s = Sprite(r * 2 + 1, r * 2 + 1)
        for y in range(s.h):
            for x in range(s.w):
                if (x - r) ** 2 + (y - r) ** 2 <= r * r + 0.5:
                    s.px(x, y, c('grey', 200))
        add(f'smoke.{r}', s)
    soot = Sprite(CW, CH)
    soot.dither(0, 0, CW, CH - 2, c('ink', 210), c('shadow', 200))
    soot.hline(2, 9, 8, c('wood'))
    soot.hline(2, 11, 8, c('wood'))
    add('burnt', soot)


def hatch_tile():
    s = Sprite(CW, CH)
    for y in range(CH):
        for x in range(CW):
            if (x + y) % 6 == 0:
                s.px(x, y, c('red', 170))
    add('hatch', s)


def vacant_sign():
    s = Sprite(9, 5)
    s.rect(0, 0, 9, 5, c('white'))
    s.ascii(1, 1, ['l..eee', 'l..ee.', 'lll.ee'], {'l': c('red'), 'e': c('red')})
    s.ascii(7, 1, ['t', 't', 't'], {'t': c('red')})
    add('tolet', s)


def street_life():
    for i, col in enumerate(['red', 'blue', 'amber', 'teal']):
        for f in range(2):
            s = Sprite(12, 6)
            s.ascii(0, 0, ['...bbbbb....', '..bwwbwwb...', 'bbbbbbbbbbbb', 'bbbbbbbbbbbl', '.kk.....kk..', '.kk.....kk..'],
                    {'b': c(col), 'w': c('ice'), 'l': c('yellow'), 'k': c('ink')})
            if f:
                s.px(2, 4, c('grey'))
                s.px(9, 5, c('grey'))
            add(f'car.street.{i}.{f}', s)
    for f, rows in enumerate([['x...x', '.x.x.', '..x..'], ['.....', 'xx.xx', '..x..']]):
        s = Sprite(5, 3)
        s.ascii(0, 0, rows, {'x': c('ink')})
        add(f'bird.{f}', s)
    tree = Sprite(9, 14)
    tree.ascii(0, 0, ['..ggg....', '.ggGgg...', 'ggGgggg..', 'gGggGgg..', '.gggggGg.', 'ggGggggg.', '.ggggGg..', '..gggg...',
                      '....w....', '....w....', '....w....', '....w....', '...www...', '..wwwww..'],
               {'g': c('green'), 'G': c('leaf'), 'w': c('wood')})
    add('tree', tree)
    lamp = Sprite(5, 14)
    lamp.ascii(0, 0, ['.sss.', 'sYYYs', '..s..'] + ['..s..'] * 10 + ['.sss.'], {'s': c('slate'), 'Y': c('yellow')})
    add('lamp', lamp)
    glow = Sprite(15, 15)
    for y in range(15):
        for x in range(15):
            d = ((x - 7) ** 2 + (y - 7) ** 2) ** 0.5
            if d <= 7:
                a = 90 if d < 3 else 55 if d < 5 else 25
                glow.px(x, y, c('lit', a))
    add('glow', glow)
    for name, rows in {
        'cloud.0': ['....wwww........', '..wwwwwwww..ww..', '.wwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwww', '.ssssssssssssss.'],
        'cloud.1': ['......wwwww.........', '..wwwwwwwwwwww..ww..', '.wwwwwwwwwwwwwwwwww.', 'wwwwwwwwwwwwwwwwwwww',
                    'wwwwwwwwwwwwwwwwwwww', '.ssssssssssssssssss.'],
        'cloud.2': ['..www.....', '.wwwwwwww.', 'wwwwwwwwww', '.ssssssss.'],
    }.items():
        s = Sprite(len(rows[0]), len(rows))
        s.ascii(0, 0, rows, {'w': c('white'), 's': c('light')})
        add(name, s)
    sun = Sprite(11, 11)
    for y in range(11):
        for x in range(11):
            d = ((x - 5) ** 2 + (y - 5) ** 2) ** 0.5
            if d <= 3.6:
                sun.px(x, y, c('yellow'))
            elif d <= 5.2 and (x + y) % 2 == 0:
                sun.px(x, y, c('amber'))
    add('sun', sun)
    moon = Sprite(9, 9)
    for y in range(9):
        for x in range(9):
            if ((x - 4) ** 2 + (y - 4) ** 2) <= 16 and ((x - 2) ** 2 + (y - 3) ** 2) > 9:
                moon.px(x, y, c('cream'))
    add('moon', moon)
    for i, rows in enumerate([['x'], ['.x.', 'xxx', '.x.']]):
        s = Sprite(len(rows[0]), len(rows))
        s.ascii(0, 0, rows, {'x': c('white')})
        add(f'star.{i}', s)
    drop = Sprite(1, 4)
    drop.ascii(0, 0, ['x', 'x', 'x', 'x'], {'x': c('ice', 200)})
    add('rain', drop)
    flake = Sprite(3, 3)
    flake.ascii(0, 0, ['.x.', 'xxx', '.x.'], {'x': c('white')})
    add('snow', flake)
    puff = Sprite(3, 3)
    puff.ascii(0, 0, ['.x.', 'xxx', '.x.'], {'x': c('silver', 220)})
    add('dust', puff)
    parked = Sprite(6, 4)
    parked.ascii(0, 0, ['.bbb..', 'bwwbb.', 'bbbbbb', '.k..k.'], {'b': c('white'), 'w': c('ice'), 'k': c('ink')})
    add('parked', parked)
    white = Sprite(2, 2)
    white.rect(0, 0, 2, 2, c('white'))
    add('white', white)


def skyline():
    """The far skyline art, quantised to the palette at art resolution."""
    src = Image.open(os.path.join(ROOT, 'assets', 'art', 'skyline-far.png')).convert('RGBA')
    w = 240
    h = round(src.height * w / src.width)
    small = src.resize((w, h), Image.BOX)
    arr = np.array(small)
    alpha = arr[..., 3] > 110
    out = np.zeros_like(arr)
    lum = arr[..., :3].mean(axis=2)
    # Two tones: a silhouette, and its lit windows (the bright pixels of the art).
    out[alpha] = c('white')
    out[alpha & (lum > lum[alpha].mean() + 50)] = c('lit')
    s = Sprite(w, h)
    s.a = out.astype(np.uint8)
    add('skyline', s)


# ---- UI ------------------------------------------------------------------------------------

def ui():
    for theme, (fill, edge, hi, shade) in {
        'light': ('white', 'slate', 'white', 'silver'), 'dark': ('shadow', 'ink', 'steel', 'ink'),
    }.items():
        p = Sprite(9, 9)
        p.rect(0, 0, 9, 9, c(edge))
        p.rect(1, 1, 7, 7, c(fill))
        p.hline(1, 1, 7, c(hi))
        p.hline(1, 7, 7, c(shade))
        for x, y in ((0, 0), (8, 0), (0, 8), (8, 8)):
            p.px(x, y, T)                                # rounded corners, a pixel each
        add(f'ui.panel.{theme}', p)
        b = Sprite(9, 9)
        b.rect(0, 0, 9, 9, c(edge))
        b.rect(1, 1, 7, 6, c(fill))
        b.hline(1, 1, 7, c(hi))
        b.rect(1, 7, 7, 1, c(shade))
        for x, y in ((0, 0), (8, 0), (0, 8), (8, 8)):
            b.px(x, y, T)
        add(f'ui.button.{theme}', b)
    on = Sprite(9, 9)
    on.rect(0, 0, 9, 9, c('navy'))
    on.rect(1, 2, 7, 6, c('blue'))
    on.hline(1, 2, 7, c('sky'))
    for x, y in ((0, 0), (8, 0), (0, 8), (8, 8)):
        on.px(x, y, T)
    add('ui.button.on', on)
    danger = on.copy()
    danger.rect(1, 2, 7, 6, c('terra'))
    danger.hline(1, 2, 7, c('orange'))
    danger.rect(0, 0, 9, 1, c('brick_dk'))
    add('ui.button.danger', danger)
    star = ['...x...', '..xxx..', 'xxxxxxx', '.xxxxx.', '.xx.xx.', 'x.....x']
    for name, col in (('star.on', 'amber'), ('star.off', 'steel')):
        s = Sprite(7, 6)
        s.ascii(0, 0, star, {'x': c(col)})
        add(f'ui.{name}', s)
    crown = Sprite(7, 5)
    crown.ascii(0, 0, ['x.x.x.x', 'xxxxxxx', 'xyxyxyx', 'xxxxxxx', '.......'], {'x': c('amber'), 'y': c('red')})
    add('ui.crown', crown)
    lock = Sprite(5, 6)
    lock.ascii(0, 0, ['.xxx.', 'x...x', 'yyyyy', 'yykyy', 'yykyy', 'yyyyy'], {'x': c('steel'), 'y': c('amber'), 'k': c('ink')})
    add('ui.lock', lock)


ICONS = {  # 12x12 tool icons (letters map to colours below)
    'lobby': ['............', '.tttttttttt.', '.wwwwwwwwww.', '.c..c..c..c.', '.cgggsgggc..', '.cg..s..gc..',
              '.cg..s..gc..', '.cg.ksk.gc..', '.cg..s..gc..', '.cgggsgggc..', '.cccccccccc.', '............'],
    'floor': ['............', '............', '............', 's.s.s.s.s.s.', '............', 's.........s.',
              '............', 's.........s.', '............', 'ssssssssssss', 'dddddddddddd', '............'],
    'dig': ['........ww..', '.......ww...', '......ww....', '.....ww.....', '....ww......', '...sss......',
            '..ssss......', '.sssss......', '..sss.......', 'bbbbbbbbbbbb', 'b.bb.bbb.bbb', 'bbbbbbbbbbbb'],
    'stairs': ['........sss.', '........s...', '......sss...', '......s.....', '....sss.....', '....s.......',
               '..sss.......', '..s.........', 'sss.........', 's...........', 'dddddddddddd', '............'],
    'escalator': ['........rrrr', '.......ss...', '......ss....', '.....ss.....', '....ss......', '...ss.......',
                  '..ss........', '.ss.........', 'rrrr........', '............', 'dddddddddddd', '............'],
    'elevator': ['...dddddd...', '...dyyyyd...', '...dyrryd...', '...dyrryd...', '...dyrryd...', '...dyrryd...',
                 '...dyrryd...', '...dyrryd...', '...dyyyyd...', '...dddddd...', '...d....d...', '............'],
    'car': ['.dddddd.....', '.dyyyyd.....', '.dyrryd.....', '.dyrryd.ggg.', '.dyrryd.ggg.', '.dyrrydggggg',
            '.dyrrydggggg', '.dyrryd.ggg.', '.dyyyyd.ggg.', '.dddddd.....', '............', '............'],
    'express': ['...nnnnnn...', '...n....n...', '...n.ii.n...', '...ni..in...', '...n.ii.n...', '...ni..in...',
                '...n.ii.n...', '...ni..in...', '...n....n...', '...nnnnnn...', '............', '............'],
    'servicelift': ['...wwwwww...', '...wyyyyw...', '...wkkkkw...', '...wyyyyw...', '...wkkkkw...', '...wyyyyw...',
                    '...wkkkkw...', '...wyyyyw...', '...wkkkkw...', '...wwwwww...', '............', '............'],
    'office': ['............', 'oooooooooooo', 'occoccoccoco', 'occoccoccoco', 'occoccoccoco', 'occoccoccoco',
               'oooooooooooo', 'okookookooko', 'oooooooooooo', 'dddddddddddd', '............', '............'],
    'shop': ['rwrwrwrwrwrw', 'rwrwrwrwrwrw', 'r.r.r.r.r.r.', 'eeeeeeeeeeee', 'eccccccceww.', 'ecRcAcGcew..',
             'eccccccceww.', 'eccccccceww.', 'eeeeeeeeeeee', 'dddddddddddd', '............', '............'],
    'food': ['............', 'eeeeeeeeeeee', 'eRAGRAGRAGRe', 'eeeeeeeeeeee', 'rrrrrrrrrrrr', '............',
             '.www...www..', '..w.....w...', '..w.....w...', '.www...www..', 'dddddddddddd', '............'],
    'flat': ['............', 'bbbbbbbbbbbb', 'bccbbbbbbccb', 'pccpbbbbpccp', 'pccpbbbbpccp', 'bccbbbbbbccb',
             'bbbbbbbbbbbb', 'kkkkkkkkkkkk', 'k.k.k.k.k.k.', 'dddddddddddd', '............', '............'],
    'hotel': ['............', 'llllllllllll', 'lcccllllllll', 'lcccllllllll', 'lcccllllkkll', 'llllllllkyyy',
              'llllllllkyyy', 'llllllllkyyy', 'llllllllllll', 'dddddddddddd', '............', '............'],
    'hall': ['............', 'pppppppppppp', 'pRRwwwwwwRRp', 'pRRwwwwwwRRp', 'pRRwwwwwwRRp', 'pRRwwwwwwRRp',
             'pppppppppppp', 'pk.k.k.k.k.p', 'pk.k.k.k.k.p', 'dddddddddddd', '............', '............'],
    'security': ['............', '..bbbbbbbb..', '..bbbbbbbb..', '..bbyyyybb..', '..bbyyyybb..', '..bbbbbbbb..',
                 '...bbbbbb...', '....bbbb....', '.....bb.....', '............', '............', '............'],
    'housekeeping': ['.........w..', '.........w..', '.........w..', '.........w..', '..ssssss.w..', '..ssssss.w..',
                     '...ssss..w..', '...ssss..w..', '...ssss.www.', '...ssss.www.', 'dddddddddddd', '............'],
    'parking': ['............', '..bbbbbbbb..', '..bbbbbbbb..', '..bbiiibbb..', '..bbibbibb..', '..bbiiibbb..',
                '..bbibbbbb..', '..bbibbbbb..', '..bbbbbbbb..', '..bbbbbbbb..', '............', '............'],
    'clinic': ['............', '....RRRR....', '....RRRR....', '....RRRR....', 'RRRRRRRRRRRR', 'RRRRRRRRRRRR',
               'RRRRRRRRRRRR', 'RRRRRRRRRRRR', '....RRRR....', '....RRRR....', '....RRRR....', '............'],
    'plant': ['............', '...ssssss...', '..sggggggs..', 'sssggggggsss', '..sggggggs..', '..sggggggs..',
              'sssggggggsss', '..sggggggs..', '...ssssss...', '............', 'dddddddddddd', '............'],
    'transit': ['............', '.wwwwwwwwww.', 'wwwwwwwwwwww', 'wccwccwccwcw', 'wccwccwccwcw', 'wwwwwwwwwwww',
                'tttttttttttt', 'wwwwwwwwwwww', '.kk......kk.', 'dddddddddddd', 'd.d.d.d.d.d.', '............'],
    'landmark': ['.....g......', '...ggGgg....', '..gGgggGg...', '.ggggGgggg..', '..ggGggGg...', '....ww......',
                 '....ww......', 'cccccccccccc', 'cwwccwwccwwc', 'cccccccccccc', 'dddddddddddd', '............'],
    'inspect': ['...kkkk.....', '..kccccK....', '.kcIIcccK...', '.kcIcccck...', '.kccccccK...', '.kcccccck...',
                '..kccccK....', '...kkkkww...', '........ww..', '.........ww.', '..........ww', '............'],
    'demolish': ['......k.....', '......k.....', '......k.....', '......k.....', '.....kkk....', '....kkkkk...',
                 '...kkkkkkk..', '...kkkkkkk..', '....kkkkk...', '.....kkk....', '.o.o..o.o.o.', 'oooooooooooo'],
}
ICON_KEY = {
    't': 'tan', 'w': 'white', 'c': 'glass', 'g': 'green', 's': 'silver', 'k': 'ink', 'd': 'slate', 'b': 'blue', 'y': 'amber',
    'r': 'red', 'n': 'navy', 'i': 'ice', 'o': 'office_dk', 'e': 'cream', 'R': 'red', 'A': 'amber', 'G': 'leaf', 'p': 'pink',
    'l': 'lavender', 'K': 'steel', 'I': 'ice',
}


def icons():
    for name, rows in ICONS.items():
        assert len(rows) == 12 and all(len(r) == 12 for r in rows), name
        s = Sprite(12, 12)
        key = dict(ICON_KEY)
        if name in ('flat',):
            key['b'] = 'beige'
            key['p'] = 'rose'
        if name in ('housekeeping',):
            key['s'] = 'sky'
            key['w'] = 'wood'
        if name in ('plant',):
            key['s'] = 'steel'
        if name in ('hall',):
            key['p'] = 'pink'
            key['R'] = 'wine'
            key['w'] = 'lit'
        if name in ('hotel',):
            key['y'] = 'sand'
            key['k'] = 'wood_dk'
        if name in ('parking',):
            key['i'] = 'white'
        if name in ('transit',):
            key['w'] = 'silver'
            key['c'] = 'glass_dk'
            key['t'] = 'teal'
        if name in ('servicelift',):
            key['w'] = 'wood_dk'
        if name in ('demolish',):
            key['o'] = 'brick'
        s.ascii(0, 0, rows, {k: c(v) for k, v in key.items()})
        add(f'icon.{name}', s)


# ---- Font ----------------------------------------------------------------------------------

FONT = {  # 5 wide x 9 tall: rows 0-6 cap height, rows 7-8 descenders; '.' empty. Trimmed to proportional widths.
    ' ': ['...', '...', '...', '...', '...', '...', '...', '...', '...'],
    'A': ['.xxx.', 'x...x', 'x...x', 'xxxxx', 'x...x', 'x...x', 'x...x'], 'B': ['xxxx.', 'x...x', 'x...x', 'xxxx.', 'x...x', 'x...x', 'xxxx.'],
    'C': ['.xxx.', 'x...x', 'x....', 'x....', 'x....', 'x...x', '.xxx.'], 'D': ['xxxx.', 'x...x', 'x...x', 'x...x', 'x...x', 'x...x', 'xxxx.'],
    'E': ['xxxxx', 'x....', 'x....', 'xxxx.', 'x....', 'x....', 'xxxxx'], 'F': ['xxxxx', 'x....', 'x....', 'xxxx.', 'x....', 'x....', 'x....'],
    'G': ['.xxx.', 'x...x', 'x....', 'x.xxx', 'x...x', 'x...x', '.xxxx'], 'H': ['x...x', 'x...x', 'x...x', 'xxxxx', 'x...x', 'x...x', 'x...x'],
    'I': ['xxx', '.x.', '.x.', '.x.', '.x.', '.x.', 'xxx'], 'J': ['..xxx', '...x.', '...x.', '...x.', '...x.', 'x..x.', '.xx..'],
    'K': ['x...x', 'x..x.', 'x.x..', 'xx...', 'x.x..', 'x..x.', 'x...x'], 'L': ['x....', 'x....', 'x....', 'x....', 'x....', 'x....', 'xxxxx'],
    'M': ['x...x', 'xx.xx', 'x.x.x', 'x.x.x', 'x...x', 'x...x', 'x...x'], 'N': ['x...x', 'x...x', 'xx..x', 'x.x.x', 'x..xx', 'x...x', 'x...x'],
    'O': ['.xxx.', 'x...x', 'x...x', 'x...x', 'x...x', 'x...x', '.xxx.'], 'P': ['xxxx.', 'x...x', 'x...x', 'xxxx.', 'x....', 'x....', 'x....'],
    'Q': ['.xxx.', 'x...x', 'x...x', 'x...x', 'x.x.x', 'x..x.', '.xx.x'], 'R': ['xxxx.', 'x...x', 'x...x', 'xxxx.', 'x.x..', 'x..x.', 'x...x'],
    'S': ['.xxxx', 'x....', 'x....', '.xxx.', '....x', '....x', 'xxxx.'], 'T': ['xxxxx', '..x..', '..x..', '..x..', '..x..', '..x..', '..x..'],
    'U': ['x...x', 'x...x', 'x...x', 'x...x', 'x...x', 'x...x', '.xxx.'], 'V': ['x...x', 'x...x', 'x...x', 'x...x', 'x...x', '.x.x.', '..x..'],
    'W': ['x...x', 'x...x', 'x...x', 'x.x.x', 'x.x.x', 'x.x.x', '.x.x.'], 'X': ['x...x', 'x...x', '.x.x.', '..x..', '.x.x.', 'x...x', 'x...x'],
    'Y': ['x...x', 'x...x', '.x.x.', '..x..', '..x..', '..x..', '..x..'], 'Z': ['xxxxx', '....x', '...x.', '..x..', '.x...', 'x....', 'xxxxx'],
    'a': ['....', '....', '.xx.', '...x', '.xxx', 'x..x', '.xxx'], 'b': ['x...', 'x...', 'xxx.', 'x..x', 'x..x', 'x..x', 'xxx.'],
    'c': ['....', '....', '.xx.', 'x...', 'x...', 'x...', '.xx.'], 'd': ['...x', '...x', '.xxx', 'x..x', 'x..x', 'x..x', '.xxx'],
    'e': ['....', '....', '.xx.', 'x..x', 'xxxx', 'x...', '.xx.'], 'f': ['..x', '.x.', 'xxx', '.x.', '.x.', '.x.', '.x.'],
    'g': ['....', '....', '.xxx', 'x..x', 'x..x', '.xxx', '...x', 'x..x', '.xx.'], 'h': ['x...', 'x...', 'xxx.', 'x..x', 'x..x', 'x..x', 'x..x'],
    'i': ['x', '.', 'x', 'x', 'x', 'x', 'x'], 'j': ['..x', '...', '..x', '..x', '..x', '..x', '..x', 'x.x', '.x.'],
    'k': ['x...', 'x...', 'x..x', 'x.x.', 'xx..', 'x.x.', 'x..x'], 'l': ['xx', '.x', '.x', '.x', '.x', '.x', '.x'],
    'm': ['.....', '.....', 'xx.x.', 'x.x.x', 'x.x.x', 'x.x.x', 'x...x'], 'n': ['....', '....', 'xxx.', 'x..x', 'x..x', 'x..x', 'x..x'],
    'o': ['....', '....', '.xx.', 'x..x', 'x..x', 'x..x', '.xx.'], 'p': ['....', '....', 'xxx.', 'x..x', 'x..x', 'xxx.', 'x...', 'x...', 'x...'],
    'q': ['....', '....', '.xxx', 'x..x', 'x..x', '.xxx', '...x', '...x', '...x'], 'r': ['...', '...', 'x.x', 'xx.', 'x..', 'x..', 'x..'],
    's': ['....', '....', '.xxx', 'x...', '.xx.', '...x', 'xxx.'], 't': ['.x.', '.x.', 'xxx', '.x.', '.x.', '.x.', '..x'],
    'u': ['....', '....', 'x..x', 'x..x', 'x..x', 'x..x', '.xxx'], 'v': ['.....', '.....', 'x...x', 'x...x', 'x...x', '.x.x.', '..x..'],
    'w': ['.....', '.....', 'x...x', 'x...x', 'x.x.x', 'x.x.x', '.x.x.'], 'x': ['....', '....', 'x..x', 'x..x', '.xx.', 'x..x', 'x..x'],
    'y': ['....', '....', 'x..x', 'x..x', 'x..x', '.xxx', '...x', 'x..x', '.xx.'], 'z': ['....', '....', 'xxxx', '...x', '.xx.', 'x...', 'xxxx'],
    '0': ['.xxx.', 'x...x', 'x..xx', 'x.x.x', 'xx..x', 'x...x', '.xxx.'], '1': ['.x.', 'xx.', '.x.', '.x.', '.x.', '.x.', 'xxx'],
    '2': ['.xxx.', 'x...x', '....x', '...x.', '..x..', '.x...', 'xxxxx'], '3': ['xxxx.', '....x', '....x', '.xxx.', '....x', '....x', 'xxxx.'],
    '4': ['...x.', '..xx.', '.x.x.', 'x..x.', 'xxxxx', '...x.', '...x.'], '5': ['xxxxx', 'x....', 'xxxx.', '....x', '....x', 'x...x', '.xxx.'],
    '6': ['.xxx.', 'x....', 'x....', 'xxxx.', 'x...x', 'x...x', '.xxx.'], '7': ['xxxxx', '....x', '...x.', '..x..', '.x...', '.x...', '.x...'],
    '8': ['.xxx.', 'x...x', 'x...x', '.xxx.', 'x...x', 'x...x', '.xxx.'], '9': ['.xxx.', 'x...x', 'x...x', '.xxxx', '....x', '....x', '.xxx.'],
    '.': ['.', '.', '.', '.', '.', '.', 'x'], ',': ['.', '.', '.', '.', '.', '.', 'x', 'x'], ':': ['.', '.', 'x', '.', '.', '.', 'x'],
    ';': ['.', '.', 'x', '.', '.', '.', 'x', 'x'], '!': ['x', 'x', 'x', 'x', 'x', '.', 'x'], '?': ['.xxx.', 'x...x', '....x', '...x.', '..x..', '.....', '..x..'],
    "'": ['x', 'x', '.', '.', '.', '.', '.'], '"': ['x.x', 'x.x', '...', '...', '...', '...', '...'], '-': ['...', '...', '...', 'xxx', '...', '...', '...'],
    '+': ['.....', '..x..', '..x..', 'xxxxx', '..x..', '..x..', '.....'], '=': ['....', '....', 'xxxx', '....', 'xxxx', '....', '....'],
    '/': ['....x', '....x', '...x.', '..x..', '.x...', 'x....', 'x....'], '(': ['.x', 'x.', 'x.', 'x.', 'x.', 'x.', '.x'],
    ')': ['x.', '.x', '.x', '.x', '.x', '.x', 'x.'], '$': ['..x..', '.xxxx', 'x.x..', '.xxx.', '..x.x', 'xxxx.', '..x..'],
    '%': ['xx..x', 'xx..x', '...x.', '..x..', '.x...', 'x..xx', 'x..xx'], '&': ['.xx..', 'x..x.', 'x.x..', '.x...', 'x.x.x', 'x..x.', '.xx.x'],
    '#': ['.x.x.', '.x.x.', 'xxxxx', '.x.x.', 'xxxxx', '.x.x.', '.x.x.'], '*': ['.....', 'x.x.x', '.xxx.', 'xxxxx', '.xxx.', 'x.x.x', '.....'],
    '<': ['...x', '..x.', '.x..', 'x...', '.x..', '..x.', '...x'], '>': ['x...', '.x..', '..x.', '...x', '..x.', '.x..', 'x...'],
    '_': ['....', '....', '....', '....', '....', '....', '....', 'xxxx'], '@': ['.xxx.', 'x...x', 'x.xxx', 'x.x.x', 'x.xxx', 'x....', '.xxx.'],
    '[': ['xx', 'x.', 'x.', 'x.', 'x.', 'x.', 'xx'], ']': ['xx', '.x', '.x', '.x', '.x', '.x', 'xx'],
    '★': ['...x...', '..xxx..', 'xxxxxxx', '.xxxxx.', '.xx.xx.', 'x.....x', '.......'],
    '☆': ['...x...', '..x.x..', 'xx...xx', '.x...x.', '.x.x.x.', 'x.x.x.x', '.......'],
    '♛': ['x.x.x.x', 'xxxxxxx', 'x.x.x.x', 'xxxxxxx', 'xxxxxxx', '.......', '.......'],
    '✓': ['.....', '....x', '...x.', 'x.x..', '.x...', '.....', '.....'], '✗': ['.....', 'x...x', '.x.x.', '..x..', '.x.x.', 'x...x', '.....'],
    '…': ['.....', '.....', '.....', '.....', '.....', '.....', 'x.x.x'], '·': ['.', '.', '.', 'x', '.', '.', '.'],
    '×': ['.....', '.....', 'x...x', '.x.x.', '..x..', '.x.x.', 'x...x'], '→': ['......', '...x..', '....x.', 'xxxxxx', '....x.', '...x..', '......'],
    '❚': ['xx.xx', 'xx.xx', 'xx.xx', 'xx.xx', 'xx.xx', 'xx.xx', 'xx.xx'], '⌄': ['.......', '.......', 'x.....x', '.x...x.', '..x.x..', '...x...', '.......'],
    '⌃': ['.......', '...x...', '..x.x..', '.x...x.', 'x.....x', '.......', '.......'], '☰': ['xxxxxx', '......', '......', 'xxxxxx', '......', '......', 'xxxxxx'],
    'é': ['..x.', '.x..', '.xx.', 'x..x', 'xxxx', 'x...', '.xx.'], '₹': ['xxxx', '..x.', 'xxxx', '.x..', 'x.x.', '..x.', '...x'],
}


def font():
    glyphs = {}
    cell_h = 9
    for ch, rows in FONT.items():
        rows = rows + ['.' * len(rows[0])] * (cell_h - len(rows))
        w = max(len(r) for r in rows)
        glyphs[ch] = (w, rows)
    cols = 16
    cw = 8
    n = len(glyphs)
    img = Sprite(cols * cw, ((n + cols - 1) // cols) * cell_h)
    meta = {'height': cell_h, 'ascent': 7, 'glyphs': {}}
    for i, (ch, (w, rows)) in enumerate(glyphs.items()):
        x0, y0 = (i % cols) * cw, (i // cols) * cell_h
        img.ascii(x0, y0, rows, {'x': c('white')})
        meta['glyphs'][ch] = [x0, y0, w, w + 1 if ch != ' ' else 3]   # rect x, y, width, advance
    Image.fromarray(img.a, 'RGBA').save(os.path.join(OUT, 'font.png'))
    json.dump(meta, open(os.path.join(OUT, 'font.json'), 'w'), ensure_ascii=False, indent=0)
    return glyphs


# ---- Build ---------------------------------------------------------------------------------

def build_rooms():
    for i, (biz, accent) in enumerate(OFFICE_BIZ):
        s, lit = office(biz, accent)
        add(f'room.office.{biz}', s)
        add(f'room.office.{biz}.lit', lit)
    for biz, accent, awn in SHOP_BIZ:
        s, lit = shop(biz, accent, awn)
        add(f'room.shop.{biz}', s)
        add(f'room.shop.{biz}.lit', lit)
    for biz, accent, curtain in FLAT_BIZ:
        s, lit = flat(biz, accent, curtain)
        add(f'room.flat.{biz}', s)
        add(f'room.flat.{biz}.lit', lit)
    for biz, accent in FOOD_BIZ:
        s, lit = food(biz, accent)
        add(f'room.food.{biz}', s)
        add(f'room.food.{biz}.lit', lit)
    for biz, accent, spread in HOTEL_BIZ:
        for dirty in (False, True):
            s, lit = hotel(biz, accent, spread, dirty)
            add(f'room.hotel.{biz}{".dirty" if dirty else ""}', s)
        add(f'room.hotel.{biz}.lit', lit)
    for biz, accent in HALL_BIZ:
        s, lit = hall(biz, accent)
        add(f'room.hall.{biz}', s)
        add(f'room.hall.{biz}.lit', lit)
    for kind in ('security', 'housekeeping', 'clinic', 'plant'):
        s, lit = service(kind)
        add(f'room.{kind}', s)
        add(f'room.{kind}.lit', lit)
    for name, fn in (('parking', parking), ('transit', transit)):
        s, lit = fn()
        add(f'room.{name}', s)
        add(f'room.{name}.lit', lit)
    for v in (0, 1):
        s, lit = lobby(v)
        add(f'room.lobby.{v}', s)
        add(f'room.lobby.{v}.lit', lit)
    add('room.stairs', stairs()[0])
    add('room.escalator', escalator()[0])
    add('room.floor', slab())
    add('room.landmark', landmark())
    for k in ('elevator', 'express', 'servicelift'):
        shaft(k)


def pack():
    """Shelf-pack every sprite into one atlas, tallest first; 1 px gaps against bleeding."""
    items = sorted(SPRITES.items(), key=lambda kv: (-kv[1].h, -kv[1].w))
    width = 512
    x = y = shelf = 0
    rects = {}
    for name, s in items:
        if x + s.w > width:
            x, y, shelf = 0, y + shelf + 1, 0
        rects[name] = [x, y, s.w, s.h]
        x += s.w + 1
        shelf = max(shelf, s.h)
    height = y + shelf
    atlas = np.zeros((height, width, 4), np.uint8)
    for name, (x, y, w, h) in rects.items():
        atlas[y:y + h, x:x + w] = SPRITES[name].a
    Image.fromarray(atlas, 'RGBA').save(os.path.join(OUT, 'atlas.png'))
    json.dump(rects, open(os.path.join(OUT, 'atlas.json'), 'w'), indent=0, sort_keys=True)
    return rects


def preview():
    """Every sprite at 4x on a checker, named, for reviewing the art."""
    scale, pad = 4, 6
    names = sorted(SPRITES)
    x = y = row_h = 0
    width = 1600
    placed = []
    for n in names:
        s = SPRITES[n]
        w, h = s.w * scale, s.h * scale + 12
        if x + w > width:
            x, y, row_h = 0, y + row_h + pad, 0
        placed.append((n, x, y))
        x += max(w, 60) + pad
        row_h = max(row_h, h)
    img = Image.new('RGBA', (width, y + row_h + pad), (210, 214, 222, 255))
    d = ImageDraw.Draw(img)
    for n, x, y in placed:
        s = SPRITES[n]
        tile = Image.fromarray(s.a, 'RGBA').resize((s.w * scale, s.h * scale), Image.NEAREST)
        bg = Image.new('RGBA', tile.size, (120, 130, 150, 255) if '.lit' in n or 'ui.' in n or 'person.shirt' in n else (235, 238, 243, 255))
        img.alpha_composite(bg, (x, y + 12))
        img.alpha_composite(tile, (x, y + 12))
        d.text((x, y), n[:22], fill=(20, 20, 32, 255))
    img.save(os.path.join(OUT, 'preview.png'))


def main():
    os.makedirs(OUT, exist_ok=True)
    build_rooms()
    people()
    lift_car()
    faces()
    fire()
    hatch_tile()
    vacant_sign()
    street_life()
    skyline()
    ui()
    icons()
    rects = pack()
    glyphs = font()
    preview()
    print(f'{len(rects)} sprites, {len(glyphs)} glyphs -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
