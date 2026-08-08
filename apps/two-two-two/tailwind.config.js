/** @type {import('tailwindcss').Config} */
module.exports = {
  // The preset carries NativeWind and `darkMode`. The palette is this app's own
  // — see `packages/ui/tokens.js` for the names every app has to define.
  presets: [require('../../packages/ui/tailwind.preset')],
  // Shared UI components live outside the app, so the scan has to reach them.
  // This cannot move into the preset: Tailwind lets an app's `content` replace
  // a preset's rather than extend it. Guarded by `tests/guards/tokens.test.ts`.
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm and quiet on purpose. This app is opened in the evening, often
        // in a dark room, and should not feel like a productivity tracker.
        canvas: { DEFAULT: '#F6F2EF', dark: '#14100F' },
        surface: { DEFAULT: '#FFFFFF', dark: '#201B1A' },
        ink: { DEFAULT: '#231D1B', dark: '#F2EDEA' },
        muted: { DEFAULT: '#6F625D', dark: '#A6968F' },
        line: { DEFAULT: '#E4DAD4', dark: '#332B29' },
        accent: { DEFAULT: '#9C5B4E', dark: '#D4877A' },
        // Cadence health. Amber and clay rather than yellow and red: nothing
        // here is an error, and "it's been a while" must not read as a failure.
        ontrack: { DEFAULT: '#5B7A63', dark: '#8FB197' },
        duesoon: { DEFAULT: '#B08149', dark: '#D6AA75' },
        overdue: { DEFAULT: '#A4645A', dark: '#D19288' },
      },
    },
  },
  plugins: [],
};
