import Link from "next/link";
import type { ReactNode } from "react";

export const dynamic = "force-static";

export const metadata = {
  title: "Piplup · Architecture",
  description: "READ → PIPLUP → four clocks → ACT + PROVE",
};

export default function ArchitecturePage() {
  return (
    <main className="arch flex h-screen w-screen flex-col overflow-hidden bg-[#eef1f6] text-[#02042b]">
      <style>{`
        @font-face {
          font-family: Virgil;
          src: url("/fonts/Virgil.woff2") format("woff2");
          font-display: swap;
        }
        .arch, .arch * { font-family: Virgil, "Segoe Print", cursive !important; }
      `}</style>

      <header className="flex shrink-0 items-baseline justify-between px-6 pt-3">
        <p className="text-sm text-[#6b7288]">Piplup · Eureka Labs</p>
        <p className="text-sm text-[#6b7288]">112 students · vs T+3</p>
      </header>

      <p className="shrink-0 px-6 pb-2 pt-1 text-[13px] text-[#5a6178]">
        Follow the arrows → &nbsp; a payment fails → Piplup picks one clock → we act → we prove it
      </p>

      <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_2.25rem_1.15fr_2.25rem_1.1fr] px-5">
        <Frame title="1 · READ">
          <Row>
            <Node k="INGRESS" h="It bounced" p="Razorpay fail, or the student texts." />
            <Node k="PARSE · AI" h="Reads the text" p="Pay on the 7th / wrong / stop. Unsure? Ignore." accent />
            <Node k="CLASSIFY" h="We name the why" p="Bank · no money · dead card · cancelled · drop · old bill." />
            <Node k="GRANT" h="We decide once" p="Blue door. No yes → no money." tone="blue" />
          </Row>
        </Frame>

        <Rail caption="into" />

        <Frame title="2 · PIPLUP PICKS ONE" fill>
          <div className="grid h-full min-h-0 w-full grid-cols-[4.5rem_1.75rem_minmax(0,1fr)] grid-rows-4 gap-y-3">
            <div className="row-span-4 flex items-center justify-center">
              <div className="flex h-[4.6rem] w-[4.6rem] flex-col items-center justify-center rounded-full bg-[#305eff] text-center text-white">
                <p className="text-[14px] leading-none">PIPLUP</p>
                <p className="mt-1 text-[8px] leading-3 text-white/70">Eureka Labs</p>
              </div>
            </div>
            <Arrow />
            <Node k="CASCADE" h="Bank hiccup" p="Try now. Student sees nothing." tone="green" />
            <Arrow />
            <Node k="DUNNING" h="No money yet" p="Wait payday AND the hour." tone="blue" />
            <Arrow />
            <Node k="RE-AUTH" h="AutoPay cancelled" p="Ask them to switch it on." tone="amber" />
            <Arrow />
            <Node k="STOP" h="Leave them alone" p="Dispute / paid / stop." tone="red" />
          </div>
        </Frame>

        <Rail caption="then do" />

        <Frame title="3 · ACT + PROVE">
          <Row>
            <Node k="MUTATE" h="Change the move" p="New rail · link · sweep. Never the same dead debit." tone="green" />
            <Node k="NPCI" h="Only 4 silent tries" p="1 original + 3. Link or new AutoPay = 0." />
            <Node k="LADDER" h="The plan" p="Day · hour · price. Quiet 21:00–09:00." />
            <Node k="PROVE" h="Same 112 vs T+3" p="More money back. Fewer wasted tries." tone="navy" />
          </Row>
        </Frame>
      </div>

      <div className="flex shrink-0 justify-center py-1">
        <div className="flex flex-col items-center text-[#1e1e1e]">
          <span className="text-lg leading-none">↓</span>
          <span className="text-[11px] text-[#6b7288]">next month, before it fails</span>
        </div>
      </div>

      <section className="mx-5 mb-2 grid shrink-0 grid-cols-2 gap-4">
        <Frame title="4 · DAWN">
          <Row tight>
            <Node k="SCAN" h="Next cycle" p="Nothing charged yet." tone="amber" />
            <Node k="FLAG" h="Ceiling or expiry" p="Arithmetic, not a guess." tone="amber" />
            <Node k="NOTICE" h="3 days early" p="Zero NPCI slots." tone="amber" />
          </Row>
        </Frame>
        <Frame title="TOOLS">
          <Row tight>
            <Node k="RULES" h="Class · grant · freeze" p="AI never sits here." />
            <Node k="SCORED" h="Day × hour" p="Spend a slot only if worth it." tone="blue" />
            <Node k="MATH" h="Cap vs bill" p="Card vs billing day." />
          </Row>
        </Frame>
      </section>

      <footer className="flex shrink-0 items-center justify-between bg-[#02042b] px-6 py-2.5 text-[13px] text-white">
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

function Rail({ caption }: { caption: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 text-[#1e1e1e]" aria-hidden>
      <span className="text-[11px] text-[#6b7288]">{caption}</span>
      <svg width="28" height="18" viewBox="0 0 28 18" fill="none">
        <path d="M2 9h20" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 4l8 5-8 5" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center" aria-hidden>
      <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
        <path d="M1 7h14" stroke="#1e1e1e" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M11 3l6 4-6 4" stroke="#1e1e1e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Frame({ title, children, fill }: { title: string; children: ReactNode; fill?: boolean }) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-[#c5cad6] bg-white px-3 py-3">
      <p className="mb-2 text-[12px] uppercase tracking-[0.14em] text-[#8c93a3]">{title}</p>
      <div className={`flex min-h-0 flex-1 ${fill ? "items-stretch" : "items-center"}`}>{children}</div>
    </section>
  );
}

function Row({ children, tight }: { children: ReactNode; tight?: boolean }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className={`flex w-full items-stretch ${tight ? "h-[6.75rem]" : "h-[min(36vh,220px)]"}`}>
      {items.map((child, i) => (
        <div key={i} className="flex min-w-0 flex-1 items-stretch">
          {child}
          {i < items.length - 1 ? <Arrow /> : null}
        </div>
      ))}
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
      className={`flex h-full w-full flex-col justify-center rounded-xl border px-2.5 py-2 ${box} ${
        accent ? "ring-1 ring-[#305eff]" : ""
      }`}
    >
      <p className="text-[12px] leading-none opacity-70">{k}</p>
      <p className={`mt-1.5 text-[14px] leading-5 ${tone === "navy" ? "text-white" : "text-[#02042b]"}`}>{h}</p>
      <p className={`mt-1 text-[11px] leading-4 ${tone === "navy" ? "text-white/65" : "text-[#5a6178]"}`}>{p}</p>
    </article>
  );
}
