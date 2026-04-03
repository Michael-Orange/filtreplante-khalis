import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        pine: {
          DEFAULT: "#317873",
          hover: "#285f5b",
          light: "#e8f4f3",
          dark: "#1a4a47",
        },
      },
      fontFamily: {
        sans: ["Roboto", "system-ui", "sans-serif"],
        heading: ["Inter", "system-ui", "sans-serif"],
      },
      minHeight: {
        touch: "48px",
      },
      minWidth: {
        touch: "48px",
      },
    },
  },
  plugins: [],
} satisfies Config;
