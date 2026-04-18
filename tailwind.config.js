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
        // ── Core UI palette ───────────────────────────────────────────────────
        base: {
          50:  "#FFFFFF",  // true white for maximum contrast
          100: "#F1F5F9",  // light text; subtle borders and dividers
          200: "#E2E8F0",  // secondary text (lifted from C0C8D0)
          300: "#CBD5E1",  // muted text (lifted from 9BA4B5)
          400: "#FB7185",  // bright accent rose (lifted from A63A50 for contrast)
          450: "#F59E0B",  // warm amber accent 
          500: "#E11D48",  // bright crimson (lifted from 8C1F38 for clarity)
          600: "#9F1239",  // muted rose
          700: "#7C7799",  // mid purple (lighter for boundaries/markers)
          800: "#38405F",  // dark panel surface
          850: "#1C2234",  // layered surface (between 800 and 900)
          900: "#0E131F",  // primary background
          950: "#070A12",  // deepest surface (playlist modal content)
        },

        // ── Danger ── errors, destructive actions, missing files ──────────────
        // Warm orange-red keeps hue shift away from the base crimson accent
        // and stays distinct for deuteranopia (red-green colorblindness).
        danger: {
          950: "#1E040A",  // darkest tint bg
          900: "#2B0711",  // error section bg
          800: "#49101E",  // subtle surface
          700: "#801C31",  // border
          500: "#E55B49",  // strong icon / ring
          400: "#FF8A7A",  // primary text / icon  ← main "error" color
          300: "#FFB3A8",  // lighter text
          200: "#FFD9D4",  // lightest (hover target)
        },

        // ── Caution ── warnings, out-of-sync, overwrite confirmation ──────────
        // Amber — sits adjacent to base-450 in hue but clearly distinct by value.
        caution: {
          900: "#241A0A",
          800: "#3B2A10",
          700: "#7A5210",
          500: "#D97706",
          400: "#F59E0B",  // primary text / icon  ← main "warning" color
          300: "#FCD34D",
          200: "#FEF3C7",
        },

        // ── Positive ── saves, connected, success ─────────────────────────────
        // Teal — universally distinct from both red and green; safe for all
        // types of color blindness including deuteranopia.
        positive: {
          900: "#082B2B",
          800: "#0B4242",
          700: "#116C6C",
          500: "#14B8A6",
          400: "#2DD4BF",  // primary text / icon  ← main "success" color
          300: "#5EEAD4",
        },

        // ── Lane ── waveform timeline / DAW canvas ────────────────────────────
        lane: {
          bg:    "#161A28",  // main waveform lane (raised bg to contrast waveforms)
          strip: "#111420",  // segment control strip
        },

        // ── Mark ── playhead, position markers ───────────────────────────────
        // High-luminance amber against the dark lane for maximum visibility.
        mark: {
          DEFAULT: "#FBBF24",  // marker background (brighter amber)
          fg:      "#0E131F",  // text rendered on top of marker
          border:  "#D97706",  // marker border
        },
      },

      // Custom shadow for the mute/playhead marker glow
      boxShadow: {
        mark: "0 0 8px rgba(224, 152, 32, 0.5)",
      },
    },
  },
  darkMode: "class",
  plugins: [heroui()],
};
