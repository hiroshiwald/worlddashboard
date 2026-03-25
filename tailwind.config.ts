import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "Consolas",
          "Menlo",
          "Monaco",
          "'Courier New'",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
