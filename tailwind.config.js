const { heroui } = require("@heroui/react");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        base: {
          50: "#F8FAFC",
          100: "#E2E8F0",
          200: "#C0C8D0",
          300: "#9BA4B5",
          400: "#A63A50",
          500: "#8C1F38",
          600: "#6B3D52",
          700: "#59546C",
          800: "#38405F",
          900: "#0E131F",
        }
      }
    },
  },
  darkMode: "class",
  plugins: [heroui()],
}

