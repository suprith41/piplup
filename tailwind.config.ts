import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["TASA Orbiter", "var(--font-sans)", "Inter", "sans-serif"],
      },
      colors: {
        ink: "#02042b",
        paper: "#ffffff",
        canvas: "#f4f6fb",
        rust: "#e5533c",
        moss: "#00b86b",
        rzp: "#305eff",
        navy: "#02042b",
        amber: "#ffb020",
      },
      boxShadow: {
        card: "0 1px 2px rgba(2, 4, 43, 0.04), 0 1px 3px rgba(2, 4, 43, 0.06)",
        lift: "0 8px 24px rgba(2, 4, 43, 0.08)",
      },
      transitionTimingFunction: {
        blade: "cubic-bezier(0.3, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
