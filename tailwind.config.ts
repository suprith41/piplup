import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Mulish", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["TASA Orbiter", "var(--font-sans)", "Mulish", "sans-serif"],
      },
      colors: {
        ink: "#02042b",
        paper: "#ffffff",
        rust: "#e5533c",
        moss: "#0d9f6e",
        rzp: "#305eff",
        navy: "#072654",
      },
    },
  },
  plugins: [],
};

export default config;
