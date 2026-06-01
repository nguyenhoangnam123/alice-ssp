import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0b0c",
        panel: "#141416",
        border: "#2a2a2e",
        ink: "#e6e6e6",
        muted: "#a0a0a8",
        accent: "#cc785c",
      },
    },
  },
  plugins: [],
} satisfies Config;
