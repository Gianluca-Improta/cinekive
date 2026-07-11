import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]', '[data-theme="slate"]'],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cinema: {
          black: "var(--cinema-black)",
          surface: "var(--cinema-surface)",
          panel: "var(--cinema-panel)",
          border: "var(--cinema-border)",
          muted: "var(--cinema-muted)",
          cyan: "var(--cinema-cyan)",
          magenta: "var(--cinema-magenta)",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px var(--cinema-glow)",
      },
    },
  },
  plugins: [],
};

export default config;
