import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/PlusJakartaSans";
import { Fingerprint, UsersThree, Wallet, Check } from "@phosphor-icons/react";
import { BookOpen } from "lucide-react";

/*
 * clor.in home hero, 15 s loop (owner, 13 Nov 2026). Four CLOR screens on a
 * tilted deck; each comes to the front in turn and fills in, while a dot runs
 * along the chain People -> Attendance -> Payroll -> Books underneath. White
 * ground: the site lays it over its own glow with mix-blend-mode multiply.
 * Sample figures are the same fictional ones the site draws (Windows.jsx).
 */
const { fontFamily } = loadFont("normal", { weights: ["500", "600", "700", "800"], subsets: ["latin"] });

export const FPS = 30;
export const SEG = 112.5; // frames each screen leads
export const TOTAL = SEG * 4; // 450 frames, 15 s
const MOVE = 36; // frames spent moving to the next screen, at the end of each segment

const INK = "#0f172a";
const INK2 = "#475569";
const LINE = "#e5e7eb";
const ACCENT = "#ff5400";

type App = { slug: string; name: string; accent: string; title: string };
const APPS: App[] = [
  { slug: "people", name: "People", accent: "#C93F28", title: "New joiner" },
  { slug: "attendance", name: "Attendance", accent: "#854D0E", title: "October 2026" },
  { slug: "payroll", name: "Payroll", accent: "#0079BF", title: "Pay run, October 2026" },
  { slug: "books", name: "Books", accent: "#232A66", title: "GSTR-1, October 2026" },
];

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Where the deck stands: 0..4, holding on each screen, easing between. */
function deckTime(frame: number) {
  const k = Math.floor(frame / SEG);
  const into = frame - k * SEG;
  const move = interpolate(into, [SEG - MOVE, SEG], [0, 1], { ...clamp, easing: ease });
  return k + move;
}

function Mark({ app, size }: { app: App; size: number }) {
  const s = Math.round(size * 0.52);
  const Icon = { people: UsersThree, attendance: Fingerprint, payroll: Wallet }[app.slug as "people"];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        display: "grid",
        placeItems: "center",
        background: `${app.accent}14`,
        border: `1.5px solid ${app.accent}33`,
        color: app.accent,
        flex: "none",
      }}
    >
      {Icon ? <Icon size={s} weight="duotone" /> : <BookOpen size={s} strokeWidth={1.8} />}
    </div>
  );
}

function Pill({ text, show, ok = true }: { text: string; show: number; ok?: boolean }) {
  return (
    <span
      style={{
        fontSize: 19,
        fontWeight: 700,
        padding: "6px 14px",
        borderRadius: 999,
        background: ok ? "#dcfce7" : "#fff1ea",
        color: ok ? "#15803d" : "#ba3900",
        opacity: show,
        scale: String(interpolate(show, [0, 1], [0.8, 1])),
      }}
    >
      {text}
    </span>
  );
}

function Row({ k, v, show, strong = false }: { k: string; v: string; show: number; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 0",
        borderTop: `1px solid ${LINE}`,
        fontSize: strong ? 24 : 22,
        fontWeight: strong ? 800 : 500,
        color: strong ? INK : INK2,
        opacity: show,
        translate: `0 ${interpolate(show, [0, 1], [10, 0])}px`,
      }}
    >
      <span>{k}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: INK, fontWeight: strong ? 800 : 600 }}>{v}</span>
    </div>
  );
}

/** p: 0..1, how far this screen has filled in. */
const step = (p: number, a: number, b: number) => interpolate(p, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

function PeopleBody({ p }: { p: number }) {
  const checks = ["Offer letter", "PAN and Aadhaar", "Laptop issued"];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: step(p, 0, 0.15) }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "#e6f4f1", color: "#0f766e", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 24 }}>KI</div>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, color: INK }}>Kavya Iyer</div>
          <div style={{ fontSize: 20, color: INK2 }}>Accounts executive, Pune office</div>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <Row k="Employee ID" v="E042" show={step(p, 0.1, 0.25)} />
        <Row k="Joined" v="3 June 2024" show={step(p, 0.18, 0.33)} />
        <Row k="Manager" v="Rohit Anand" show={step(p, 0.26, 0.41)} />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        {checks.map((c, i) => {
          const done = step(p, 0.45 + i * 0.15, 0.55 + i * 0.15);
          return (
            <span
              key={c}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 19,
                fontWeight: 600,
                padding: "8px 14px",
                borderRadius: 10,
                border: `1.5px solid ${done > 0.5 ? "#86efac" : LINE}`,
                background: done > 0.5 ? "#f0fdf4" : "#fff",
                color: done > 0.5 ? "#15803d" : INK2,
              }}
            >
              <span style={{ width: 20, height: 20, borderRadius: 6, display: "grid", placeItems: "center", background: done > 0.5 ? "#16a34a" : "#f1f5f9", color: "#fff", scale: String(0.6 + done * 0.4) }}>
                <Check size={13} weight="bold" />
              </span>
              {c}
            </span>
          );
        })}
      </div>
    </>
  );
}

function AttendanceBody({ p }: { p: number }) {
  const days = "PPPPPOOPPPLPPOOPPHPPPOOPPPPPOOP".split("");
  const colour: Record<string, string> = { P: "#9fd4b5", O: "#eceff3", L: "#f5c48a", H: "#cfe9d9" };
  const filled = interpolate(p, [0.05, 0.7], [0, days.length], clamp);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: INK }}>Kavya Iyer</div>
        <Pill text="Ready to close" show={step(p, 0.72, 0.82)} ok={false} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: 6, marginTop: 20 }}>
        {days.map((d, i) => {
          const s = interpolate(filled - i, [0, 1], [0, 1], clamp);
          return <div key={i} style={{ height: 34, borderRadius: 7, background: s > 0 ? colour[d] : "#f3f5f8", opacity: 0.35 + s * 0.65, scale: String(0.7 + s * 0.3) }} />;
        })}
      </div>
      <div style={{ marginTop: 20 }}>
        <Row k="Paid days" v={(Math.round(interpolate(p, [0.1, 0.75], [0, 26.5], clamp) * 2) / 2).toFixed(1)} show={step(p, 0.05, 0.2)} />
        <Row k="Leave" v="1" show={step(p, 0.3, 0.45)} />
        <Row k="Overtime" v="3 h" show={step(p, 0.45, 0.6)} />
      </div>
    </>
  );
}

function PayrollBody({ p }: { p: number }) {
  const rows: [string, number][] = [
    ["Basic", 21000],
    ["HRA", 8400],
    ["PF (employee)", -2520],
    ["Professional tax", -200],
  ];
  const net = interpolate(p, [0.45, 0.8], [0, 26680], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: INK }}>48 employees</div>
        <Pill text="Locked" show={step(p, 0.8, 0.9)} />
      </div>
      <div style={{ marginTop: 16 }}>
        {rows.map(([k, v], i) => (
          <Row key={k} k={k} v={v < 0 ? `− ${rupees(-v)}` : rupees(v)} show={step(p, 0.05 + i * 0.1, 0.18 + i * 0.1)} />
        ))}
        <Row k="Net pay, Kavya" v={rupees(net)} show={step(p, 0.42, 0.52)} strong />
      </div>
    </>
  );
}

function BooksBody({ p }: { p: number }) {
  const rows: [string, number, number][] = [
    ["B2B invoices", 142, 1840500],
    ["B2C invoices", 316, 412300],
    ["Credit notes", 6, -38200],
  ];
  const taxable = interpolate(p, [0.4, 0.78], [0, 2214600], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: INK }}>Anand Traders</div>
        <Pill text="Ready to file" show={step(p, 0.8, 0.9)} />
      </div>
      <div style={{ marginTop: 16 }}>
        {rows.map(([k, n, v], i) => (
          <Row key={k} k={`${k} · ${n}`} v={v < 0 ? `− ${rupees(-v)}` : rupees(v)} show={step(p, 0.05 + i * 0.1, 0.18 + i * 0.1)} />
        ))}
        <Row k="Taxable value" v={rupees(taxable)} show={step(p, 0.38, 0.48)} strong />
      </div>
    </>
  );
}

const BODIES: Record<string, React.FC<{ p: number }>> = { people: PeopleBody, attendance: AttendanceBody, payroll: PayrollBody, books: BooksBody };

function Screen({ app, p }: { app: App; p: number }) {
  const Body = BODIES[app.slug];
  return (
    <div
      style={{
        width: 620,
        borderRadius: 22,
        background: "#fff",
        border: `1px solid ${LINE}`,
        boxShadow: "0 2px 4px rgba(15,23,42,0.05), 0 50px 90px -40px rgba(15,23,42,0.45)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 26px", borderBottom: `1px solid ${LINE}`, background: "#f8fafc" }}>
        <Mark app={app} size={40} />
        <span style={{ fontSize: 24, fontWeight: 800, color: INK }}>{app.name}</span>
        <span style={{ marginLeft: "auto", fontSize: 20, color: INK2, fontWeight: 500 }}>{app.title}</span>
      </div>
      <div style={{ padding: "22px 26px 26px" }}>
        <Body p={p} />
      </div>
    </div>
  );
}

/** A screen's place in the deck for r = its distance from the front (-1.5 .. 2.5). */
function place(r: number) {
  const pts = [-1.5, -1, 0, 1, 2, 2.5];
  const at = (vals: number[]) => interpolate(r, pts, vals, clamp);
  return {
    x: at([-520, -420, 0, 250, 430, 490]),
    y: at([30, 20, 0, -36, -66, -80]),
    z: at([-260, -160, 0, -240, -460, -540]),
    ry: at([16, 14, -10, -18, -22, -24]),
    opacity: at([0, 0, 1, 0.7, 0.25, 0]),
    blur: at([4, 3, 0, 2.5, 4, 5]),
  };
}

function Chain({ t }: { t: number }) {
  /* The dot sits on the active product and slides to the next during each move. */
  const W = 150;
  const pos = mod(t, 4);
  const dotX = pos <= 3 ? pos * W : interpolate(pos, [3, 4], [3 * W, 0]);
  const dotOpacity = pos <= 3 ? 1 : interpolate(pos, [3, 3.2, 3.8, 4], [1, 0, 0, 1]);
  return (
    <div style={{ position: "relative", display: "flex", gap: W - 64 }}>
      <div style={{ position: "absolute", left: 32, right: 32, top: 31, height: 3, borderRadius: 2, background: "#ffd2bc" }} />
      {APPS.map((a, i) => {
        const near = 1 - Math.min(1, Math.abs(mod(pos - i + 2, 4) - 2));
        return (
          <div key={a.slug} style={{ position: "relative", display: "grid", justifyItems: "center", gap: 8, width: 64 }}>
            <div style={{ scale: String(1 + near * 0.18), background: "#fff", borderRadius: 18, boxShadow: near > 0.5 ? `0 10px 24px -10px ${a.accent}88` : "none" }}>
              <Mark app={a} size={64} />
            </div>
            <span style={{ fontSize: 22, fontWeight: 700, color: near > 0.5 ? INK : INK2, whiteSpace: "nowrap", opacity: 0.55 + near * 0.45 }}>{a.name}</span>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 64 + 0,
          width: 13,
          height: 13,
          borderRadius: 7,
          background: ACCENT,
          boxShadow: `0 0 0 6px ${ACCENT}2e`,
          translate: `${dotX + 22 - 64}px 0`,
          opacity: dotOpacity,
        }}
      />
    </div>
  );
}

export const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const t = deckTime(frame);

  const screens = APPS.map((app, i) => {
    let r = mod(i - t, 4);
    if (r > 2.5) r -= 4;
    /* Fill-in: empty while waiting at the back, fills once it reaches the front. */
    const local = mod(frame - (i * SEG - MOVE), TOTAL);
    const p = interpolate(local, [MOVE * 0.6, SEG - 6], [0, 1], clamp);
    const waitingAtBack = local > SEG * 1.6;
    return { app, r, p: waitingAtBack ? 0 : p, ...place(r) };
  });
  /* Paint back to front. */
  screens.sort((a, b) => a.z - b.z);

  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily }}>
      <AbsoluteFill style={{ perspective: 1800, perspectiveOrigin: "50% 40%" }}>
        <div style={{ position: "absolute", left: 250, top: 64, transformStyle: "preserve-3d", rotate: "x 8deg" }}>
          {screens.map((s) => (
            <div
              key={s.app.slug}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate3d(${s.x}px, ${s.y}px, ${s.z}px) rotateY(${s.ry}deg)`,
                opacity: s.opacity,
                filter: s.blur > 0.2 ? `blur(${s.blur}px)` : undefined,
              }}
            >
              <Screen app={s.app} p={s.p} />
            </div>
          ))}
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "center" }}>
        <Chain t={t} />
      </div>
    </AbsoluteFill>
  );
};
