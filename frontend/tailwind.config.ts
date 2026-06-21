import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111318",
        panel: "#1a1d24",
        rail: "#252a33",
        line: "#343a46",
        mint: "#34d399",
        coral: "#fb7185",
        amber: "#fbbf24"
      }
    }
  },
  plugins: []
};

export default config;
