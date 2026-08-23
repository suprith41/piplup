import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        ink: "#0b1220",
        paper: "#f4f1ea",
        rust: "#c24a2b",
        moss: "#1f6b4a",
      },
    },
  },
  plugins: [],
};

export default config;
