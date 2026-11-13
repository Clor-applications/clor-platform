"""The two drawn sign-in pictures, as isometric SVG. No dependencies.

app.clor.in: two office buildings with the workspace itself in front of them,
an open floor of desks (owner, 13 Nov 2026: "1-2 buildings with workspace").
ops.clor.in: a tech park by day, several office towers, roads, cars, a
shield and a locked gate (owner: "tech park with multiple buildings",
"day time, no night, no moon").

Usage: python3 scripts/auth-buildings.py public/auth
Writes signin-hq.svg and signin-ops.svg. Top left stays clear for the title the
page sets in type; bottom left stays calm for the quote card."""
import math, sys
C30, S30 = math.cos(math.radians(30)), 0.5

def shade(hexc, f):
    h = hexc.lstrip('#'); r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    if f >= 1: r, g, b = (round(c + (255 - c) * (f - 1)) for c in (r, g, b))
    else: r, g, b = (round(c * f) for c in (r, g, b))
    return '#%02x%02x%02x' % (r, g, b)

class Scene:
    def __init__(self, s=62, cx=640, cy=330):
        self.s, self.cx, self.cy, self.items, self.defs, self.n = s, cx, cy, [], [], 0
    def p(self, x, y, z):
        return (self.cx + (x - y) * C30 * self.s, self.cy + (x + y) * S30 * self.s - z * self.s)
    def pts(self, *q):
        return ' '.join('%.1f,%.1f' % self.p(*a) for a in q)
    def grad(self, a, b, vertical=True):
        self.n += 1; i = 'g%d' % self.n
        d = 'x1="0" y1="0" x2="0" y2="1"' if vertical else 'x1="0" y1="0" x2="1" y2="0"'
        self.defs.append('<linearGradient id="%s" %s><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>' % (i, d, a, b))
        return 'url(#%s)' % i
    def face_m(self, side, x, y, z, w, d):
        s = self.s
        if side == 'L':
            ox, oy = self.p(x, y + d, z); return 'matrix(%.3f %.3f 0 %.3f %.1f %.1f)' % (C30 * s, S30 * s, -s, ox, oy)
        ox, oy = self.p(x + w, y + d, z); return 'matrix(%.3f %.3f 0 %.3f %.1f %.1f)' % (C30 * s, -S30 * s, -s, ox, oy)
    def box(self, x, y, z, w, d, h, col, windows=None, lit='#ffffff', soft=5, extra=None, order=None):
        top, left, right = shade(col, 1.28), col, shade(col, 0.74)
        o = []
        j = 'stroke-linejoin="round" stroke-width="%d"' % soft
        o.append('<polygon points="%s" fill="%s" stroke="%s" %s/>' % (self.pts((x, y + d, z), (x + w, y + d, z), (x + w, y + d, z + h), (x, y + d, z + h)), self.grad(shade(left, 1.08), shade(left, 0.9)), left, j))
        o.append('<polygon points="%s" fill="%s" stroke="%s" %s/>' % (self.pts((x + w, y + d, z), (x + w, y, z), (x + w, y, z + h), (x + w, y + d, z + h)), self.grad(shade(right, 1.06), shade(right, 0.86)), right, j))
        o.append('<polygon points="%s" fill="%s" stroke="%s" %s/>' % (self.pts((x, y, z + h), (x + w, y, z + h), (x + w, y + d, z + h), (x, y + d, z + h)), top, top, j))
        if windows:
            cols, rows, gapx, gapz, m, op = windows
            for side, span in (('L', w), ('R', d)):
                ww = (span - 2 * m - (cols - 1) * gapx) / cols
                wh = (h - 2 * m - (rows - 1) * gapz) / rows
                g = ['<g transform="%s">' % self.face_m(side, x, y, z, w, d)]
                for r in range(rows):
                    for c in range(cols):
                        on = (r * 7 + c * 3 + (1 if side == 'L' else 0)) % 5 != 0
                        g.append('<rect x="%.3f" y="%.3f" width="%.3f" height="%.3f" rx="0.06" fill="%s" opacity="%.2f"/>' % (m + c * (ww + gapx), m + r * (wh + gapz), ww, wh, lit, (op if on else op * 0.42) * (1 if side == 'L' else 0.8)))
                g.append('</g>'); o.append(''.join(g))
        if extra: o.append(extra(self, x, y, z, w, d, h))
        self.items.append((order if order is not None else (x + w / 2 + y + d / 2, z), ''.join(o)))
    def raw(self, order, svg):
        self.items.append((order, svg))
    def tree(self, x, y, size=1.0, col='#3fae6b'):
        tx, ty = self.p(x, y, 0); s = self.s * size
        svg = '<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="#000" opacity="0.12"/>' % (tx, ty + 3, s * 0.42, s * 0.16)
        svg += '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="#8a5a3c"/>' % (tx - s * 0.07, ty - s * 0.62, s * 0.14, s * 0.64, s * 0.06)
        for dx, dy, r, f in ((0, -1.02, 0.46, 1.0), (-0.3, -0.78, 0.34, 0.88), (0.3, -0.8, 0.36, 0.94), (0.02, -1.36, 0.3, 1.14)):
            svg += '<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (tx + dx * s, ty + dy * s, r * s, shade(col, f))
        svg += '<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#fff" opacity="0.16"/>' % (tx - 0.14 * s, ty - 1.2 * s, 0.16 * s)
        self.items.append(((x + y, 0.1), svg))
    def out(self, w, h, bg, pre='', post=''):
        body = ''.join(v for _, v in sorted(self.items, key=lambda a: a[0]))
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d"><defs>%s%s</defs>%s%s%s%s</svg>' % (w, h, w, h, ''.join(self.defs), bg[0], bg[1], pre, body, post)

def cloud(x, y, s, op=0.9, col='#ffffff'):
    return '<g fill="%s" opacity="%.2f"><ellipse cx="%d" cy="%d" rx="%d" ry="%d"/><circle cx="%d" cy="%d" r="%d"/><circle cx="%d" cy="%d" r="%d"/><circle cx="%d" cy="%d" r="%d"/></g>' % (col, op, x, y, 70 * s, 22 * s, x - 30 * s, y - 14 * s, 26 * s, x + 4 * s, y - 28 * s, 34 * s, x + 36 * s, y - 12 * s, 24 * s)

def flat(sc, order, x, y, w, d, fill, z=0.03, op=1.0, extra=''):
    sc.raw(order, '<polygon points="%s" fill="%s" opacity="%.2f" %s/>' % (sc.pts((x, y, z), (x + w, y, z), (x + w, y + d, z), (x, y + d, z)), fill, op, extra))

def car(sc, x, y, col, along='x'):
    w, d = (0.95, 0.46) if along == 'x' else (0.46, 0.95)
    k = x + y + 0.7
    sc.box(x, y, 0.06, w, d, 0.2, col, soft=3, order=(k, 0.2))
    cw, cd = (0.5, 0.4) if along == 'x' else (0.4, 0.5)
    sc.box(x + (w - cw) / 2, y + (d - cd) / 2, 0.26, cw, cd, 0.17, shade(col, 1.5), soft=2, order=(k, 0.3))

def lamp(sc, x, y, col):
    lx, ly = sc.p(x, y, 0)
    sc.raw((x + y, 0.4), '<rect x="%.1f" y="%.1f" width="3" height="34" rx="1.5" fill="#8fa0c8"/><circle cx="%.1f" cy="%.1f" r="20" fill="%s" opacity="0.22"/><circle cx="%.1f" cy="%.1f" r="5" fill="%s"/>' % (lx - 1.5, ly - 34, lx, ly - 36, col, lx, ly - 36, col))

def shield(sc, x, y, z, w, d, h):
    m = sc.face_m('R', x, y, z, w, d)
    return ('<g transform="%s"><g transform="translate(%.2f %.2f) scale(0.72 -0.72)">'
            '<path d="M0 -1.25 L1.0 -0.85 V0.1 C1.0 0.85 0.5 1.25 0 1.5 C-0.5 1.25 -1.0 0.85 -1.0 0.1 V-0.85 Z" fill="#ff5400"/>'
            '<path d="M0 -1.25 L1.0 -0.85 V0.1 C1.0 0.85 0.5 1.25 0 1.5 Z" fill="#000" opacity="0.14"/>'
            '<path d="M-0.42 0.02 L-0.1 0.36 L0.46 -0.3" fill="none" stroke="#fff" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round"/>'
            '</g></g>') % (m, d * 0.5, h * 0.55)

def entrance(col):
    def f(sc, x, y, z, w, d, h):
        return '<g transform="%s"><rect x="%.2f" y="0" width="1.1" height="0.95" rx="0.12" fill="%s"/><rect x="%.2f" y="0.08" width="0.46" height="0.8" rx="0.06" fill="#fff" opacity="0.3"/></g>' % (sc.face_m('L', x, y, z, w, d), w / 2 - 0.55, col, w / 2 - 0.5)
    return f

DAY = dict(ground='#efd9c6', lawn='#cfe8c4', road='#7d8798', dash='#ffffff', walk='#fff3e6', plaza='#ffe7d1', pod='#eef1f7',
           a='#3d4fe0', b='#ff6f5b', c='#12b5e5', d='#ffb627', e='#8fa3c9', la='#d5dbff', lb='#ffe3de', lc='#dcf6ff', ld='#fff3d3', le='#f2f6ff',
           tree='#3fae6b', water='#6fd0f2', cars=('#ff5400', '#ffffff', '#3d4fe0', '#12b5e5', '#ffb627', '#22c3b3'))
NIGHT = dict(ground='#101c47', lawn='#16306a', road='#0a1230', dash='#ffc24a', walk='#1f2f70', plaza='#22357c', pod='#1a2a66',
             a='#2f46a8', b='#27408f', c='#1f5f9e', d='#31489f', e='#1c2c6c', la='#7fe3ff', lb='#ffd27a', lc='#7fe3ff', ld='#ffb08a', le='#7fe3ff',
             tree='#1f7a5c', water='#12b5e5', cars=('#ff5400', '#cfd8f5', '#12b5e5', '#ffb627', '#7fe3ff', '#ff7a66'))

def park(night=False, ops=True):
    """ops.clor.in: a tech park by day. `ops` adds what makes it the operations campus:
    the shield on one office, the locked gate, the dish. `night` is the same park after dark."""
    P = NIGHT if night else DAY
    sc = Scene(s=37, cx=612, cy=430)
    glass = lambda floors, cols=7: (cols, floors, 0.06, 0.16, 0.22, 0.92 if not night else 0.95)
    if night:
        bg = ('<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1530"/><stop offset="1" stop-color="#14245a"/></linearGradient>'
              '<radialGradient id="glA" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#12b5e5" stop-opacity="0.5"/><stop offset="1" stop-color="#12b5e5" stop-opacity="0"/></radialGradient>'
              '<radialGradient id="glB" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff5400" stop-opacity="0.4"/><stop offset="1" stop-color="#ff5400" stop-opacity="0"/></radialGradient>',
              '<rect width="1200" height="1200" fill="url(#sky)"/><circle cx="1000" cy="180" r="430" fill="url(#glA)"/><circle cx="150" cy="1060" r="460" fill="url(#glB)"/>')
        pre = ''.join('<circle cx="%d" cy="%d" r="%.1f" fill="#fff" opacity="%.2f"/>' % q for q in ((140, 250, 2.4, .8), (320, 330, 1.8, .6), (90, 470, 2, .6), (760, 90, 2, .7), (1100, 380, 2.4, .8), (900, 60, 1.6, .5), (1150, 610, 1.8, .5), (560, 60, 1.6, .6), (230, 560, 1.6, .5)))
        pre += '<circle cx="1040" cy="170" r="50" fill="#f4f7ff"/><circle cx="1060" cy="157" r="46" fill="#173060"/>'
        sky_col, sky_op = '#1b2c6b', 0.9
    else:
        bg = ('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6d0"/><stop offset="0.5" stop-color="#fff4ea"/><stop offset="1" stop-color="#fbe2cf"/></linearGradient><radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffd08a" stop-opacity="0.95"/><stop offset="1" stop-color="#ffd08a" stop-opacity="0"/></radialGradient>',
              '<rect width="1200" height="1200" fill="url(#sky)"/><circle cx="1010" cy="190" r="300" fill="url(#sun)"/><circle cx="1010" cy="190" r="62" fill="#ffb627"/><circle cx="1010" cy="190" r="62" fill="#fff" opacity="0.22"/>')
        pre = cloud(150, 430, 1.2) + cloud(1090, 470, 0.9, 0.8) + cloud(780, 110, 0.7, 0.75)
        sky_col, sky_op = '#f3cdb4', 0.55
    # a far skyline, so the park stands in a city
    for x, w, h in ((40, 70, 150), (118, 54, 220), (180, 86, 120), (880, 60, 170), (948, 90, 250), (1046, 64, 140), (1118, 70, 200), (470, 50, 90), (300, 60, 110)):
        pre += '<rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="%s" opacity="%.2f"/>' % (x, 640 - h, w, h + 40, sky_col, sky_op)
    pre += '<ellipse cx="612" cy="1040" rx="560" ry="110" fill="#000" opacity="%.2f"/>' % (0.3 if night else 0.1)
    if night:
        for k, c in enumerate(('#ff7a33', '#ffc24a', '#38c6e6')):
            a, b = -1.3 + k * 0.4, 17.3 - k * 0.4
            sc.raw((-100 + k, 0), '<polygon points="%s" fill="none" stroke="%s" stroke-width="4" stroke-linejoin="round"/><polygon points="%s" fill="none" stroke="%s" stroke-width="14" stroke-linejoin="round" opacity="0.2"/>' % (sc.pts((a, a, 0), (b, a, 0), (b, b, 0), (a, b, 0)), c, sc.pts((a, a, 0), (b, a, 0), (b, b, 0), (a, b, 0)), c))
    # the plot, its lawns, the two roads that cross it
    sc.box(-0.5, -0.5, -0.5, 17.0, 17.0, 0.5, P['ground'], soft=8, order=(-96, 0))
    for (x, y, w, d) in ((0, 0, 6.9, 6.9), (9.1, 0, 6.9, 6.9), (0, 9.1, 6.9, 6.9), (9.1, 9.1, 6.9, 6.9)):
        flat(sc, (-95, 0), x, y, w, d, P['lawn'], extra='stroke="%s" stroke-width="7" stroke-linejoin="round"' % P['lawn'])
    flat(sc, (-94, 0), 0, 7.1, 16, 1.8, P['road']); flat(sc, (-94, 1), 7.1, 0, 1.8, 16, P['road'])
    for i in range(10):
        t = 0.5 + i * 1.6
        if not 6.7 < t < 8.9:
            flat(sc, (-93, 0), t, 7.94, 0.7, 0.12, P['dash'], op=0.9); flat(sc, (-93, 1), 7.94, t, 0.12, 0.7, P['dash'], op=0.9)
    # zebra crossings by the junction
    for i in range(4):
        flat(sc, (-93, 2), 6.2, 7.25 + i * 0.42, 0.7, 0.2, '#ffffff', op=0.85 if not night else 0.5)
        flat(sc, (-93, 3), 7.25 + i * 0.42, 9.2, 0.2, 0.7, '#ffffff', op=0.85 if not night else 0.5)

    # back: the headquarters tower on its podium
    sc.box(0.9, 0.9, 0.03, 5.4, 5.4, 0.5, P['pod'], soft=5, order=(6.0, 0))
    sc.box(1.4, 1.4, 0.53, 4.3, 4.3, 9.6, P['a'], glass(12, 8), lit=P['la'])
    sc.box(2.0, 2.0, 10.13, 3.1, 3.1, 0.25, shade(P['a'], 0.75), soft=4, order=(7.3, 11))
    sc.box(3.3, 3.3, 10.38, 0.5, 0.5, 1.3, '#e6e9f5' if not night else '#cfd8f5', soft=3, order=(7.4, 11))
    px, py = sc.p(3.55, 3.55, 12.2)
    sc.raw((7.5, 12), '<circle cx="%.1f" cy="%.1f" r="42" fill="#ff5400" opacity="%.2f"/><circle cx="%.1f" cy="%.1f" r="22" fill="#ff5400"/><circle cx="%.1f" cy="%.1f" r="8" fill="#fff"/>' % (px, py, 0.3 if night else 0.2, px, py, px, py))
    # right back: two office towers, joined to the headquarters by a bridge
    sc.box(9.6, 0.9, 0.03, 3.1, 3.4, 7.0, P['b'], glass(9, 6), lit=P['lb'])
    sc.box(13.0, 1.6, 0.03, 2.5, 4.4, 4.6, P['e'], glass(6, 6), lit=P['le'], extra=shield if ops else None)
    sc.box(5.7, 2.5, 4.2, 3.9, 0.8, 0.55, shade(P['c'], 1.15), (9, 1, 0.05, 0.1, 0.12, 0.9), lit=P['lc'], soft=3, order=(10.4, 4))
    sc.box(10.1, 1.5, 7.03, 2.1, 2.2, 0.2, shade(P['b'], 0.75), soft=4, order=(13.0, 8))
    # left front: a mid tower and a long low block with a roof garden
    sc.box(1.0, 9.6, 0.03, 3.6, 3.0, 5.8, P['c'], glass(7, 7), lit=P['lc'])
    sc.box(1.2, 13.1, 0.03, 4.6, 2.2, 2.3, P['d'], glass(3, 9), lit=P['ld'])
    for i in range(4):
        gx, gy = sc.p(1.8 + i * 1.05, 14.2, 2.33)
        sc.raw((16.2 + i * 0.1, 3), '<circle cx="%.1f" cy="%.1f" r="11" fill="%s"/><circle cx="%.1f" cy="%.1f" r="7" fill="%s"/>' % (gx, gy - 7, P['tree'], gx + 7, gy - 2, shade(P['tree'], 1.2)))
    # front right: the plaza, its fountain, a pavilion and the car park
    flat(sc, (-92, 0), 11.6, 11.4, 4.0, 4.2, P['plaza'])
    fx, fy = sc.p(13.6, 13.5, 0.03)
    sc.raw((27.1, 0), '<ellipse cx="%.1f" cy="%.1f" rx="46" ry="26" fill="%s"/><ellipse cx="%.1f" cy="%.1f" rx="36" ry="19" fill="%s"/><ellipse cx="%.1f" cy="%.1f" rx="12" ry="6" fill="#fff" opacity="0.7"/><rect x="%.1f" y="%.1f" width="4" height="26" rx="2" fill="#fff" opacity="0.8"/>' % (fx, fy, shade(P['pod'], 0.9), fx, fy - 2, P['water'], fx, fy - 4, fx - 2, fy - 30))
    sc.box(9.6, 13.2, 0.03, 1.7, 2.3, 1.7, P['d'], glass(2, 4), lit=P['ld'], extra=entrance('#7a3d00' if not night else '#0b1530'))
    sc.box(9.5, 13.1, 1.73, 1.9, 2.5, 0.14, '#ff5400', soft=3, order=(24.9, 2))
    flat(sc, (-92, 1), 9.4, 9.4, 6.2, 1.6, P['walk'])
    for i in range(6):
        if i != 3:
            car(sc, 9.6 + i * 1.0, 9.6, P['cars'][i], along='y')
    # traffic on the roads
    car(sc, 3.0, 7.3, P['cars'][0]); car(sc, 12.4, 8.2, P['cars'][2]); car(sc, 7.3, 12.6, P['cars'][4], along='y'); car(sc, 8.2, 2.6, P['cars'][1], along='y')
    # trees along the roads and at the corners
    for x, y, z in ((6.3, 0.6, .7), (6.3, 6.3, .75), (0.5, 6.3, .8), (9.5, 6.4, .7), (15.4, 6.4, .8), (15.5, 0.5, .75), (0.5, 0.5, .7), (5.6, 9.6, .75), (6.2, 12.2, .7), (6.3, 15.5, .8), (0.4, 15.6, .75), (15.5, 15.5, .85), (15.5, 11.8, .7), (11.8, 15.6, .7), (13.0, 6.5, .65)):
        sc.tree(x, y, z * 1.5, P['tree'])
    if night:
        for x, y in ((6.7, 3.5), (6.7, 11.5), (9.3, 5.0), (3.5, 9.3), (12.5, 6.7), (9.3, 12.0), (4.5, 6.7)):
            lamp(sc, x, y, '#ffc24a')
    if ops:
        # the gate with its lock, where the road meets the edge
        sc.box(15.4, 7.0, 0.03, 0.5, 2.0, 1.2, '#16245a' if night else '#3d4a6b', soft=4, order=(23.6, 0))
        gx, gy = sc.p(15.9, 8.0, 0.75)
        sc.raw((23.7, 1), '<g transform="translate(%.1f %.1f) scale(0.8)"><path d="M-13 -6 v-12 a13 13 0 0 1 26 0 v12" fill="none" stroke="#cfd8f5" stroke-width="7" stroke-linecap="round"/><rect x="-21" y="-8" width="42" height="34" rx="9" fill="#ffb627"/><circle cy="7" r="5" fill="#16245a"/><rect x="-2.5" y="8" width="5" height="10" rx="2.5" fill="#16245a"/></g>' % (gx, gy))
        # a dish on the long low block
        dx, dy = sc.p(4.9, 14.0, 2.33)
        sc.raw((19.0, 4), '<rect x="%.1f" y="%.1f" width="6" height="34" rx="3" fill="#cfd8f5"/><ellipse cx="%.1f" cy="%.1f" rx="34" ry="22" fill="#e8edff" transform="rotate(-28 %.1f %.1f)"/><ellipse cx="%.1f" cy="%.1f" rx="25" ry="15" fill="#b9c6f2" transform="rotate(-28 %.1f %.1f)"/>' % (dx - 3, dy - 34, dx, dy - 46, dx, dy - 46, dx + 3, dy - 48, dx + 3, dy - 48))
    return sc.out(1200, 1200, bg, pre)

def desk(sc, x, y, z, chair):
    """A desk with its screen and a chair in front of it, on a floor at height z."""
    k = x + y
    sc.box(x, y, z, 1.15, 0.6, 0.36, '#ffffff', soft=2, order=(k + 0.9, z + 0.1))
    sc.box(x + 0.38, y + 0.08, z + 0.36, 0.44, 0.07, 0.3, '#1f2a4d', soft=1, order=(k + 0.95, z + 0.5))
    mx, my = sc.p(x + 0.6, y + 0.15, z + 0.52)
    sc.raw((k + 0.96, z + 0.6), '<g transform="%s"><rect x="0.03" y="0.04" width="0.38" height="0.22" rx="0.03" fill="#7fe3ff"/></g>' % sc.face_m('L', x + 0.38, y + 0.08, z + 0.36, 0.44, 0.07))
    sc.box(x + 0.42, y + 0.78, z, 0.32, 0.32, 0.26, chair, soft=2, order=(k + 1.4, z + 0.1))
    sc.box(x + 0.42, y + 1.04, z + 0.26, 0.32, 0.07, 0.3, shade(chair, 0.85), soft=1, order=(k + 1.45, z + 0.3))

def workspace():
    """app.clor.in: two office buildings and, in front of them, the workspace itself: an
    open floor of desks, a meeting table and plants, with its glass walls behind."""
    P = DAY
    sc = Scene(s=52, cx=600, cy=498)
    glass = lambda floors, cols=7: (cols, floors, 0.06, 0.16, 0.22, 0.92)
    bg = ('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6d0"/><stop offset="0.5" stop-color="#fff4ea"/><stop offset="1" stop-color="#fbe2cf"/></linearGradient><radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffd08a" stop-opacity="0.95"/><stop offset="1" stop-color="#ffd08a" stop-opacity="0"/></radialGradient>',
          '<rect width="1200" height="1200" fill="url(#sky)"/><circle cx="1010" cy="190" r="300" fill="url(#sun)"/><circle cx="1010" cy="190" r="62" fill="#ffb627"/><circle cx="1010" cy="190" r="62" fill="#fff" opacity="0.22"/>')
    pre = cloud(150, 430, 1.2) + cloud(1090, 480, 0.9, 0.8) + cloud(800, 110, 0.7, 0.75)
    for x, w, h in ((40, 70, 150), (118, 54, 220), (180, 86, 120), (948, 90, 250), (1046, 64, 140), (1118, 70, 200)):
        pre += '<rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="#f3cdb4" opacity="0.5"/>' % (x, 660 - h, w, h + 40)
    pre += '<ellipse cx="600" cy="1110" rx="540" ry="80" fill="#b4673a" opacity="0.14"/>'
    sc.box(-0.5, -0.5, -0.5, 12.0, 12.0, 0.5, P['ground'], soft=8, order=(-96, 0))
    flat(sc, (-95, 0), 0, 0, 11, 11, P['lawn'], extra='stroke="%s" stroke-width="8" stroke-linejoin="round"' % P['lawn'])
    flat(sc, (-94, 0), 0.6, 5.7, 9.8, 0.55, P['walk'])
    # the head office: a glass tower on its podium, the orange mark on its roof
    sc.box(0.8, 0.8, 0.03, 4.6, 4.6, 0.5, P['pod'], soft=5, order=(5.0, 0))
    sc.box(1.2, 1.2, 0.53, 3.8, 3.8, 8.2, P['a'], glass(11, 8), lit=P['la'])
    sc.box(1.7, 1.7, 8.73, 2.8, 2.8, 0.25, shade(P['a'], 0.75), soft=4, order=(6.3, 9))
    sc.box(2.85, 2.85, 8.98, 0.5, 0.5, 1.2, '#e6e9f5', soft=3, order=(6.4, 9))
    px, py = sc.p(3.1, 3.1, 10.7)
    sc.raw((6.5, 11), '<circle cx="%.1f" cy="%.1f" r="50" fill="#ff5400" opacity="0.2"/><circle cx="%.1f" cy="%.1f" r="28" fill="#ff5400"/><circle cx="%.1f" cy="%.1f" r="10" fill="#fff"/>' % (px, py, px, py, px, py))
    # the second office, joined to the first by a bridge, with a garden on its roof
    sc.box(6.3, 1.3, 0.03, 3.4, 3.8, 4.8, P['b'], glass(6, 7), lit=P['lb'])
    sc.box(4.9, 2.6, 2.6, 1.5, 0.8, 0.55, shade(P['c'], 1.15), (4, 1, 0.05, 0.1, 0.12, 0.9), lit=P['lc'], soft=3, order=(8.6, 3))
    for x, y in ((7.0, 2.0), (8.3, 2.6), (7.4, 3.8), (8.8, 4.2)):
        gx, gy = sc.p(x, y, 4.83)
        sc.raw((x + y + 3, 5), '<circle cx="%.1f" cy="%.1f" r="17" fill="%s"/><circle cx="%.1f" cy="%.1f" r="11" fill="%s"/>' % (gx, gy - 10, P['tree'], gx + 11, gy - 3, shade(P['tree'], 1.2)))
    # the workspace: an open floor in front, its glass walls behind it
    sc.box(0.9, 6.5, 0.03, 9.3, 4.0, 0.3, '#f6e3cf', soft=5, order=(11.0, 0))
    sc.box(0.9, 6.5, 0.33, 9.3, 0.1, 1.5, '#9fdcf2', (9, 1, 0.06, 0.1, 0.1, 0.55), lit='#ffffff', soft=2, order=(11.1, 1))
    sc.box(0.9, 6.5, 0.33, 0.1, 4.0, 1.5, '#9fdcf2', soft=2, order=(11.1, 1))
    sc.box(0.8, 6.4, 1.83, 9.5, 0.3, 0.14, '#ff5400', soft=3, order=(11.2, 2))
    chairs = ('#ff5400', '#3d4fe0', '#12b5e5', '#ffb627')
    for i in range(4):
        desk(sc, 1.5 + i * 1.5, 7.0, 0.33, chairs[i])
    for i in range(3):
        desk(sc, 1.5 + i * 1.5, 8.7, 0.33, chairs[(i + 2) % 4])
    # a meeting table with four seats, and a sofa
    tx, ty = sc.p(8.4, 8.3, 0.75)
    sc.box(8.3, 8.2, 0.33, 0.2, 0.2, 0.4, '#c98a5b', soft=1, order=(17.2, 0.4))
    sc.raw((17.3, 0.8), '<ellipse cx="%.1f" cy="%.1f" rx="46" ry="26" fill="#ffffff"/><ellipse cx="%.1f" cy="%.1f" rx="46" ry="26" fill="#ffb627" opacity="0.18"/>' % (tx, ty, tx, ty))
    for dx, dy, c in ((-0.75, 0, chairs[0]), (0.75, 0, chairs[1]), (0, -0.75, chairs[2]), (0, 0.75, chairs[3])):
        sc.box(8.25 + dx, 8.15 + dy, 0.33, 0.3, 0.3, 0.26, c, soft=2, order=(16.6 + dx + dy + (0.9 if dx + dy > 0 else 0), 0.4))
    sc.box(6.3, 9.7, 0.33, 1.9, 0.5, 0.3, '#3d4fe0', soft=3, order=(17.9, 0.4))
    sc.box(6.3, 10.1, 0.33, 1.9, 0.14, 0.62, '#2b3bc0', soft=2, order=(18.3, 0.4))
    # plants on the floor, trees round the plot
    for x, y in ((1.2, 10.0), (9.7, 7.0), (9.7, 10.0), (5.6, 7.0)):
        gx, gy = sc.p(x, y, 0.33)
        sc.raw((x + y + 0.5, 0.5), '<rect x="%.1f" y="%.1f" width="16" height="14" rx="4" fill="#ffffff"/><circle cx="%.1f" cy="%.1f" r="15" fill="%s"/><circle cx="%.1f" cy="%.1f" r="10" fill="%s"/>' % (gx - 8, gy - 14, gx, gy - 24, P['tree'], gx + 8, gy - 18, shade(P['tree'], 1.2)))
    for x, y, z in ((0.3, 5.0, 1.1), (10.5, 0.5, 1.15), (10.5, 5.2, 1.0), (0.3, 0.4, 0.95), (5.7, 0.4, 0.9), (10.6, 10.6, 1.2), (0.2, 10.7, 1.1)):
        sc.tree(x, y, z * 1.25, P['tree'])
    return sc.out(1200, 1200, bg, pre)


out = sys.argv[1]
open(out + '/signin-hq.svg', 'w').write(workspace())
open(out + '/signin-ops.svg', 'w').write(park())
print('ok')
