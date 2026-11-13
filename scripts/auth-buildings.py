"""The two drawn sign-in pictures: the company building (app.clor.in) and the
operations building (ops.clor.in), as isometric SVG. No dependencies.

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

def door(col):
    def f(sc, x, y, z, w, d, h):
        return '<g transform="%s"><rect x="%.2f" y="0" width="0.9" height="1.25" rx="0.45" fill="%s"/><rect x="%.2f" y="0" width="0.4" height="1.13" rx="0.2" fill="#fff" opacity="0.28"/></g>' % (sc.face_m('L', x, y, z, w, d), w / 2 - 0.45, col, w / 2 - 0.39)
    return f

def workspace():
    sc = Scene(s=50, cx=600, cy=478)
    bg = ('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9d6"/><stop offset="0.55" stop-color="#fff5ec"/><stop offset="1" stop-color="#fbe4d2"/></linearGradient><radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffd08a" stop-opacity="0.95"/><stop offset="1" stop-color="#ffd08a" stop-opacity="0"/></radialGradient>',
          '<rect width="1200" height="1200" fill="url(#sky)"/><circle cx="960" cy="200" r="300" fill="url(#sun)"/><circle cx="960" cy="200" r="70" fill="#ffb627"/><circle cx="960" cy="200" r="70" fill="#fff" opacity="0.22"/>')
    pre = cloud(170, 420, 1.3) + cloud(1050, 470, 1.0, 0.8) + cloud(700, 120, 0.8, 0.75)
    # ground shadow and plaza
    pre += '<ellipse cx="600" cy="1010" rx="520" ry="120" fill="#b4673a" opacity="0.16"/>'
    sc.box(-1.6, -1.6, -0.45, 12.6, 12.6, 0.45, '#f3d9c4', soft=10, order=(-99, 0))
    sc.box(-1.0, -1.0, 0, 11.4, 11.4, 0.14, '#fff3e6', soft=6, order=(-98, 0))
    # path to the door
    sc.raw((-97, 0), '<polygon points="%s" fill="#ffd9b8"/>' % sc.pts((6.4, 9.6, 0.15), (7.8, 9.6, 0.15), (7.8, 10.4, 0.15), (6.4, 10.4, 0.15)))
    # podium
    sc.box(1.2, 1.2, 0.14, 8.6, 8.6, 0.5, '#e9edf5', soft=6)
    win = lambda c, r: (c, r, 0.2, 0.22, 0.34, 0.9)
    # four wings, one per app: Books, People, Payroll, Attendance
    sc.box(1.8, 1.8, 0.64, 3.5, 3.5, 6.6, '#3d4fe0', win(4, 7), lit='#cfd6ff')
    sc.box(5.7, 1.8, 0.64, 3.5, 3.5, 4.9, '#ff6f5b', win(4, 5), lit='#ffe0da')
    sc.box(1.8, 5.7, 0.64, 3.5, 3.5, 4.0, '#12b5e5', win(4, 4), lit='#d6f4ff')
    sc.box(5.7, 5.7, 0.64, 3.5, 3.5, 2.7, '#ffb627', win(4, 2), lit='#fff1cf', extra=door('#7a3d00'))
    # roofs: a garden, a terrace, the sign
    sc.box(2.3, 2.3, 7.24, 2.5, 2.5, 0.22, '#2b3bc0', soft=4, order=(7.2, 8))
    sc.box(3.3, 3.3, 7.46, 0.5, 0.5, 1.2, '#e6e9f5', soft=3, order=(7.3, 8))
    px, py = sc.p(3.55, 3.55, 9.25)
    sc.raw((7.4, 9), '<circle cx="%.1f" cy="%.1f" r="46" fill="#ff5400" opacity="0.22"/><circle cx="%.1f" cy="%.1f" r="30" fill="#ff5400"/><circle cx="%.1f" cy="%.1f" r="11" fill="#fff"/><circle cx="%.1f" cy="%.1f" r="30" fill="#fff" opacity="0.14"/>' % (px, py, px, py, px, py, px - 9, py - 9))
    for (x, y, z) in ((6.6, 2.8, 5.54), (7.9, 3.6, 5.54)):
        gx, gy = sc.p(x, y, z)
        sc.raw((x + y + 2, 6), '<circle cx="%.1f" cy="%.1f" r="20" fill="#3fae6b"/><circle cx="%.1f" cy="%.1f" r="13" fill="#57c583"/>' % (gx, gy - 12, gx + 14, gy - 4))
    sc.box(2.3, 6.2, 4.64, 1.1, 2.4, 0.18, '#ffffff', soft=3, order=(9.5, 5))
    # awning over the door
    sc.box(6.6, 9.15, 2.05, 1.7, 0.5, 0.14, '#ff5400', soft=4, order=(16.5, 2))
    # trees, planters, a bench
    for x, y, s in ((0.1, 9.6, 1.25), (9.9, 0.4, 1.1), (0.2, 3.2, 0.95), (3.4, 10.0, 0.9), (9.9, 9.9, 1.05)):
        sc.tree(x, y, s)
    sc.box(8.9, 9.9, 0.14, 0.9, 0.34, 0.22, '#c98a5b', soft=3, order=(19.0, 0))
    return sc.out(1200, 1200, bg, pre)

def shield(sc, x, y, z, w, d, h):
    m = sc.face_m('R', x, y, z, w, d)
    cx, cy = d * 0.56, h * 0.52
    return ('<g transform="%s"><g transform="translate(%.2f %.2f) scale(1 -1)">'
            '<path d="M0 -1.25 L1.0 -0.85 V0.1 C1.0 0.85 0.5 1.25 0 1.5 C-0.5 1.25 -1.0 0.85 -1.0 0.1 V-0.85 Z" fill="#ff5400"/>'
            '<path d="M0 -1.25 L1.0 -0.85 V0.1 C1.0 0.85 0.5 1.25 0 1.5 Z" fill="#000" opacity="0.14"/>'
            '<path d="M-0.42 0.02 L-0.1 0.36 L0.46 -0.3" fill="none" stroke="#fff" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round"/>'
            '</g></g>') % (m, cx, cy)

def ops():
    sc = Scene(s=50, cx=600, cy=486)
    bg = ('<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1530"/><stop offset="1" stop-color="#14245a"/></linearGradient>'
          '<radialGradient id="glA" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#12b5e5" stop-opacity="0.5"/><stop offset="1" stop-color="#12b5e5" stop-opacity="0"/></radialGradient>'
          '<radialGradient id="glB" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff5400" stop-opacity="0.42"/><stop offset="1" stop-color="#ff5400" stop-opacity="0"/></radialGradient>',
          '<rect width="1200" height="1200" fill="url(#sky)"/><circle cx="980" cy="200" r="420" fill="url(#glA)"/><circle cx="160" cy="1040" r="460" fill="url(#glB)"/>')
    pre = ''.join('<circle cx="%d" cy="%d" r="%.1f" fill="#fff" opacity="%.2f"/>' % (x, y, r, o) for x, y, r, o in ((140, 150, 2.4, .8), (320, 90, 1.8, .6), (470, 210, 2.2, .7), (760, 110, 2, .7), (1080, 330, 2.4, .8), (1010, 90, 1.6, .5), (90, 420, 1.8, .5), (250, 330, 1.6, .6), (1130, 560, 1.8, .5), (610, 60, 1.6, .6)))
    pre += '<circle cx="1030" cy="170" r="54" fill="#f4f7ff"/><circle cx="1052" cy="156" r="50" fill="#173060"/>'
    pre += '<ellipse cx="600" cy="1020" rx="540" ry="120" fill="#000" opacity="0.3"/>'
    # three lit outlines on the ground, as on clor.in
    for k, c in enumerate(('#ff7a33', '#ffc24a', '#38c6e6')):
        a, b = -1.25 + k * 0.42, 12.25 - k * 0.42
        sc.raw((-100 + k, 0), '<polygon points="%s" fill="none" stroke="%s" stroke-width="5" stroke-linejoin="round" opacity="0.95"/><polygon points="%s" fill="none" stroke="%s" stroke-width="16" stroke-linejoin="round" opacity="0.2"/>' % (sc.pts((a, a, 0), (b, a, 0), (b, b, 0), (a, b, 0)), c, sc.pts((a, a, 0), (b, a, 0), (b, b, 0), (a, b, 0)), c))
    sc.box(-0.4, -0.4, 0, 11.8, 11.8, 0.2, '#1a2a66', soft=8, order=(-96, 0))
    lit = '#7fe3ff'
    # main hall with the shield on its right face
    sc.box(1.6, 1.6, 0.2, 7.8, 7.8, 3.3, '#24378a', (7, 3, 0.2, 0.26, 0.42, 0.95), lit=lit, extra=shield)
    # the tower behind it
    sc.box(2.4, 2.4, 3.5, 3.6, 3.6, 5.2, '#2f46a8', (4, 6, 0.18, 0.2, 0.34, 0.95), lit=lit, order=(6.0, 4))
    sc.box(2.9, 2.9, 8.7, 2.6, 2.6, 0.25, '#1a2a66', soft=4, order=(6.1, 9))
    # mast and beacon
    sc.box(4.0, 4.0, 8.95, 0.3, 0.3, 2.2, '#cfd8f5', soft=3, order=(6.2, 9))
    bx, by = sc.p(4.15, 4.15, 11.3)
    sc.raw((6.3, 12), '<circle cx="%.1f" cy="%.1f" r="60" fill="#ff5400" opacity="0.2"/><circle cx="%.1f" cy="%.1f" r="34" fill="#ff5400" opacity="0.3"/><circle cx="%.1f" cy="%.1f" r="15" fill="#ff7a33"/><circle cx="%.1f" cy="%.1f" r="6" fill="#fff"/>' % (bx, by, bx, by, bx, by, bx - 3, by - 3))
    # a dish on the hall's roof
    dx, dy = sc.p(7.6, 3.2, 3.5)
    sc.raw((11.5, 5), '<rect x="%.1f" y="%.1f" width="8" height="46" rx="4" fill="#cfd8f5"/><ellipse cx="%.1f" cy="%.1f" rx="46" ry="30" fill="#e8edff" transform="rotate(-28 %.1f %.1f)"/><ellipse cx="%.1f" cy="%.1f" rx="34" ry="20" fill="#b9c6f2" transform="rotate(-28 %.1f %.1f)"/><circle cx="%.1f" cy="%.1f" r="6" fill="#12b5e5"/>' % (dx - 4, dy - 46, dx, dy - 62, dx, dy - 62, dx + 4, dy - 64, dx + 4, dy - 64, dx + 12, dy - 76))
    # server blocks along the left side, each with a row of lights
    for i, c in enumerate(('#12b5e5', '#ffb627', '#ff7a66')):
        x = 2.0 + i * 1.9
        sc.box(x, 9.9, 0.2, 1.4, 0.9, 1.3, '#16245a', soft=4, order=(x + 12, 0))
        lx, ly = sc.p(x + 0.25, 10.8, 1.1)
        sc.raw((x + 12.1, 1), ''.join('<circle cx="%.1f" cy="%.1f" r="6" fill="%s"/>' % (lx + k * 20, ly + k * 11.5, c if k != 1 else '#ffffff') for k in range(3)))
    # the gate, with its lock
    sc.box(9.9, 1.7, 0.2, 0.5, 2.0, 1.4, '#16245a', soft=4, order=(13.5, 0))
    gx, gy = sc.p(10.4, 2.7, 0.9)
    sc.raw((13.6, 1), '<g transform="translate(%.1f %.1f)"><path d="M-13 -6 v-12 a13 13 0 0 1 26 0 v12" fill="none" stroke="#cfd8f5" stroke-width="7" stroke-linecap="round"/><rect x="-21" y="-8" width="42" height="34" rx="9" fill="#ffb627"/><circle cy="7" r="5" fill="#16245a"/><rect x="-2.5" y="8" width="5" height="10" rx="2.5" fill="#16245a"/></g>' % (gx, gy))
    return sc.out(1200, 1200, bg, pre)

out = sys.argv[1]
open(out + '/signin-hq.svg', 'w').write(workspace())
open(out + '/signin-ops.svg', 'w').write(ops())
print('ok')
