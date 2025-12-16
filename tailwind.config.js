/** @type {import('tailwindcss').Config} */
import defaultTheme from "tailwindcss/defaultTheme";
import { solidtimeTheme } from "@solidtime/ui/tailwind.theme.js";
import forms from "@tailwindcss/forms";
import typography from "@tailwindcss/typography";

export default {
  darkMode: ["selector", ".dark"],
  content: [
    "./entrypoints/**/*.{vue,js,ts,jsx,tsx,html}",
    "./node_modules/@solidtime/ui/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      ...solidtimeTheme,
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [
    forms,
    typography,
    require("@tailwindcss/container-queries"),
    require("@tailwindcss/forms"),
  ],
};
