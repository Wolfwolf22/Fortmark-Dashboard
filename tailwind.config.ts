import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        track: "hsl(var(--track))",
        tint: "hsl(var(--tint))",
        surface: "hsl(var(--surface))",
        chart: {
          active: "hsl(var(--chart-active))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
          grid: "hsl(var(--chart-grid))",
        },
        status: {
          good: "hsl(var(--status-good))",
          "good-bg": "hsl(var(--status-good-bg))",
          warn: "hsl(var(--status-warn))",
          "warn-bg": "hsl(var(--status-warn-bg))",
          bad: "hsl(var(--status-bad))",
          "bad-bg": "hsl(var(--status-bad-bg))",
        },
      },
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
        display: ["var(--font-archivo-black)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "1.5rem",
        panel: "1rem",
        composer: "1rem",
        lg: "0.75rem",
        md: "0.625rem",
        sm: "0.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.06)",
        "card-hover":
          "0 2px 4px rgb(0 0 0 / 0.05), 0 16px 32px rgb(0 0 0 / 0.09)",
        pop: "0 4px 12px rgb(0 0 0 / 0.08), 0 12px 32px rgb(0 0 0 / 0.10)",
      },
      letterSpacing: {
        micro: "0.1em",
      },
      keyframes: {
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "caret-blink": "caret-blink 1.1s ease-out infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
