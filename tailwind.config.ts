import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // "Ink" — the whole app reads slate-*; re-tinting the scale toward
        // deep indigo night-blue restyles every page that uses it.
        slate: {
          50: "#F4F6FB",
          100: "#E9EDF6",
          200: "#D7DDEC",
          300: "#B4BED8",
          400: "#8693B6",
          500: "#5E6A8E",
          600: "#454F71",
          700: "#333C58",
          800: "#232A42",
          900: "#161C30",
          950: "#0B0F1E",
        },
        // Sodium-lamp amber. Reserved for the agent: primary actions, live
        // scan activity, the on-watch pulse. Tint with opacity (signal/10).
        signal: {
          DEFAULT: "#FFB224",
          deep: "#B97A00",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { lg: "0.75rem", md: "0.5rem", sm: "0.375rem" },
      keyframes: {
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        // Mobile bottom sheets (the "More" nav) enter from the bottom edge.
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        sweep: "sweep 1.6s ease-in-out infinite",
        "sheet-up": "sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        "fade-in": "fade-in 180ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
