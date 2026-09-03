import Link from "next/link";
import { Children, type ReactNode } from "react";

export const dynamic = "force-static";

export const metadata = {
  title: "Piplup · Architecture",
  description: "READ → PIPLUP → four clocks → ACT + PROVE",
};

const INK = "#02042b";

export default function ArchitecturePage() {
  return (
    <main className="arch flex flex-col overflow-hidden bg-[#eef1f6] text-[#02042b]">
      <style>{`
        @font-face {
          font-family: Virgil;
          src: url("/fonts/Virgil.woff2") format("woff2");
          font-display: swap;
        }
        .arch {
          zoom: 1.25;
          width: calc(100vw / 1.25);
          height: calc(100vh / 1.25);
        }
        @supports not (zoom: 1.25) {
          .arch {
            transform: scale(1.25);
            transform-origin: top left;
          }
        }
        .arch, .arch * { font-family: Virgil, "Segoe Print", cursive !important; }
      `}</style>

      <header className="flex shrink-0 items-baseline justify-between px-6 pt-3">
        <p className="text-sm text-[#6b7288]">Piplup · Eureka Labs</p>
        <p className="text-sm text-[#6b7288]">112 students · vs T+3</p>
      </header>
      <p className="shrink-0 px-6 pb-1.5 text-[13px] text-[#5a6178]">
        One line through the night. Fail → read → Piplup picks one clock → we act → we prove → we prevent.
      </p>

      <div className="mx-5 mb-2 grid min-h-0 flex-1 grid-cols-[1fr_2.75rem_1.2fr_2.75rem_1fr] grid-rows-[minmax(0,1fr)_1.75rem_auto] gap-x-0">
        <Frame title="1 · READ">
          <VFlow>
            <Node k="INGRESS" h="It bounced" p="Razorpay fail, or the student texts." />
            <Node k="PARSE · AI" h="Reads the text" p="Pay on the 7th / wrong / stop. Unsure? Ignore." accent />
            <Node k="CLASSIFY" h="We name the why" p="Bank · no money · dead card · cancelled." />
            <Node k="GRANT" h="We decide once" p="Blue door. No yes → no money." tone="blue" />
          </VFlow>
        </Frame>

        <HArrow label="into" />

        <Frame title="2 · PIPLUP PICKS ONE">
          <div className="grid h-full min-h-0 w-full grid-cols-[4.25rem_2.25rem_minmax(0,1fr)]">
            <div className="flex items-center justify-center">
              <div className="flex h-[4.4rem] w-[4.4rem] flex-col items-center justify-center rounded-full bg-[#305eff] text-center text-white">
                <p className="text-[13px] leading-none">PIPLUP</p>
                <p className="mt-1 text-[8px] leading-3 text-white/70">Eureka Labs</p>
              </div>
            </div>
            <Fan lines="out" />
            <div className="grid min-h-0 grid-rows-4 gap-2 py-0.5">
              <Node k="CASCADE" h="Bank hiccup" p="Try now. Student sees nothing." tone="green" />
              <Node k="DUNNING" h="No money yet" p="Wait payday AND the hour." tone="blue" />
              <Node k="RE-AUTH" h="AutoPay cancelled" p="Ask them to switch it on." tone="amber" />
              <Node k="STOP" h="Leave them alone" p="Dispute / paid / stop." tone="red" />
            </div>
          </div>
        </Frame>

        <Fan lines="in" label="then do" />

        <Frame title="3 · ACT + PROVE">
          <VFlow>
            <Node k="MUTATE" h="Change the move" p="New rail · link · sweep. Never the same debit." tone="green" />
            <Node k="NPCI" h="Only 4 silent tries" p="1 original + 3. Link or new AutoPay = 0." />
            <Node k="LADDER" h="The plan" p="Day · hour · price. Quiet 21:00–09:00." />
            <Node k="PROVE" h="Same 112 vs T+3" p="More money back. Fewer wasted tries." tone="navy" />
          </VFlow>
        </Frame>

        <div />
        <div />
        <VArrow label="feeds the pick" up />
        <div />
        <VArrow label="next month, before it fails" />

        <Frame title="TOOLS · how we decide" span>
          <HFlow>
            <Node k="RULES" h="Class · grant · freeze" p="AI never sits here." />
            <Node k="SCORED" h="Day × hour" p="Spend a slot only if worth it." tone="blue" />
            <Node k="MATH" h="Cap vs bill" p="Card vs billing day." />
          </HFlow>
        </Frame>
        <div />
        <Frame title="4 · DAWN">
          <HFlow>
            <Node k="SCAN" h="Next cycle" p="Nothing charged yet." tone="amber" />
            <Node k="FLAG" h="Ceiling or expiry" p="Arithmetic, not a guess." tone="amber" />
            <Node k="NOTICE" h="3 days early" p="Zero NPCI slots." tone="amber" />
          </HFlow>
        </Frame>
      </div>

      <footer className="flex shrink-0 items-center justify-between bg-[#02042b] px-6 py-2 text-[13px] text-white">
        <p>
          <span className="text-[#9db4ff]">AI sits on PARSE only.</span> It never classifies, never grants, never
          touches money.
        </p>
        <div className="flex gap-4 text-white/40">
          <Link href="/" className="hover:text-white">
            Desk
          </Link>
          <Link href="/lab" className="hover:text-white">
            Lab
          </Link>
        </div>
      </footer>
    </main>
  );
}

function Frame({ title, children, span }: { title: string; children: ReactNode; span?: boolean }) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-visible rounded-2xl border border-[#c5cad6] bg-white px-2.5 py-2 ${
        span ? "col-span-3" : ""
      }`}
    >
      <p className="mb-1.5 shrink-0 text-[11px] uppercase tracking-[0.14em] text-[#8c93a3]">{title}</p>
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  );
}

function VFlow({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <div className="flex h-full w-full flex-col justify-center">
      {items.map((child, i) => (
        <div key={i} className="w-full shrink-0">
          <div className="h-[5.6rem] w-full">{child}</div>
          {i < items.length - 1 ? <VJoin /> : null}
        </div>
      ))}
    </div>
  );
}

function HFlow({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <div className="flex h-[7.25rem] w-full min-w-0 items-stretch">
      {items.map((child, i) => (
        <div key={i} className="flex min-h-0 min-w-0 flex-1 items-stretch">
          {child}
          {i < items.length - 1 ? <HJoin /> : null}
        </div>
      ))}
    </div>
  );
}

function VJoin() {
  return (
    <div className="-my-1.5 flex h-5 shrink-0 items-center justify-center" aria-hidden>
      <svg width="12" height="20" viewBox="0 0 12 20">
        <path d="M6 0 V13" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M1.4 11 L6 19 L10.6 11 Z" fill={INK} />
      </svg>
    </div>
  );
}

function HJoin() {
  return (
    <div className="-mx-0.5 flex w-6 shrink-0 items-center justify-center" aria-hidden>
      <svg width="22" height="12" viewBox="0 0 22 12">
        <path d="M0 6 H14" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M12 1.3 L21 6 L12 10.7 Z" fill={INK} />
      </svg>
    </div>
  );
}

function HArrow({ label }: { label?: string }) {
  return (
    <div className="-mx-2 flex items-center justify-center" aria-hidden>
      <div className="relative w-full">
        <svg className="h-3 w-full" viewBox="0 0 40 12" preserveAspectRatio="none">
          <path d="M0 6 H30" stroke={INK} strokeWidth="3.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <svg className="absolute right-0 top-1/2 -translate-y-1/2" width="13" height="13" viewBox="0 0 12 12">
          <path d="M1 1.4 L11 6 L1 10.6 Z" fill={INK} />
        </svg>
        {label ? (
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-[#6b7288]">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function VArrow({ label, up }: { label?: string; up?: boolean }) {
  return (
    <div className="-my-2.5 relative" aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 24 28" preserveAspectRatio="none">
        <path d="M12 1 V27" stroke={INK} strokeWidth="3.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <svg
        className="absolute left-1/2"
        width="13"
        height="13"
        viewBox="0 0 12 12"
        style={{
          top: up ? 0 : "auto",
          bottom: up ? "auto" : 0,
          transform: up ? "translate(-50%, -10%) rotate(-90deg)" : "translate(-50%, 10%) rotate(90deg)",
        }}
      >
        <path d="M1 1.4 L11 6 L1 10.6 Z" fill={INK} />
      </svg>
      {label ? (
        <p className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-[#eef1f6] px-1 text-[10px] text-[#6b7288]">
          {label}
        </p>
      ) : null}
    </div>
  );
}

function Fan({ lines, label }: { lines: "out" | "in"; label?: string }) {
  const out = lines === "out";
  return (
    <div className="relative min-h-0" aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 36 400" preserveAspectRatio="none">
        {(out
          ? ["M0 200 C 14 200, 14 50, 36 50", "M0 200 C 14 200, 14 150, 36 150", "M0 200 C 14 200, 14 250, 36 250", "M0 200 C 14 200, 14 350, 36 350"]
          : ["M0 50 C 16 50, 16 200, 36 200", "M0 150 C 16 150, 16 200, 36 200", "M0 250 C 16 250, 16 200, 36 200", "M0 350 C 16 350, 16 200, 36 200"]
        ).map((d) => (
          <path key={d} d={d} fill="none" stroke={INK} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {(out ? [50, 150, 250, 350] : [200]).map((y) => (
        <svg
          key={y}
          className="absolute right-0"
          width="11"
          height="12"
          viewBox="0 0 12 12"
          style={{ top: `${(y / 400) * 100}%`, transform: "translate(10%, -50%)" }}
        >
          <path d="M1 1.4 L11 6 L1 10.6 Z" fill={INK} />
        </svg>
      ))}
      {label ? (
        <span className="absolute left-1/2 top-[calc(50%-1.15rem)] -translate-x-1/2 whitespace-nowrap text-[11px] text-[#6b7288]">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function Node({
  k,
  h,
  p,
  tone = "plain",
  accent,
}: {
  k: string;
  h: string;
  p: string;
  tone?: "plain" | "blue" | "green" | "amber" | "red" | "navy";
  accent?: boolean;
}) {
  const box = {
    plain: "border-[#d0d5e0] bg-[#fbfcfe] text-[#02042b]",
    blue: "border-[#305eff] bg-[#eef2ff] text-[#2448e0]",
    green: "border-[#12a866] bg-[#e8f8f0] text-[#0b7a4a]",
    amber: "border-[#e6a317] bg-[#fff8e8] text-[#8a5a00]",
    red: "border-[#d94b3a] bg-[#fdecea] text-[#b13224]",
    navy: "border-[#02042b] bg-[#02042b] text-white",
  }[tone];

  return (
    <article
      className={`flex h-full w-full min-w-0 flex-col justify-center rounded-xl border px-2.5 py-2.5 ${box} ${
        accent ? "ring-1 ring-[#305eff]" : ""
      }`}
    >
      <p className={`text-[11px] leading-4 ${tone === "navy" ? "text-white/80" : ""}`}>{k}</p>
      <p className={`mt-1 text-[13px] leading-5 ${tone === "navy" ? "text-white" : "text-[#02042b]"}`}>{h}</p>
      <p className={`mt-1 text-[11px] leading-4 ${tone === "navy" ? "text-white/70" : "text-[#3d4456]"}`}>{p}</p>
    </article>
  );
}
