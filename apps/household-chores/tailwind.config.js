/** @type {import('tailwindcss').Config} */
module.exports = {
  // The preset carries NativeWind and `darkMode`. The palette is this app's own
  // — see `packages/ui/tokens.js` for the names every app has to define.
  presets: [require('../../packages/ui/tailwind.preset')],
  // Shared UI components live outside the app, so the scan has to reach them.
  // This cannot move into the preset: Tailwind lets an app's `content` replace
  // a preset's rather than extend it. Guarded by `tests/guards/tokens.test.ts`.
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cool and plain, deliberately unlike the couple apps. This one is a
        // utility — it gets opened to find out whose turn it is and then closed
        // again — so it reads as a tool rather than as somewhere to linger.
        canvas: { DEFAULT: '#F4F6F8', dark: '#0E1116' },
        surface: { DEFAULT: '#FFFFFF', dark: '#171B22' },
        ink: { DEFAULT: '#16181D', dark: '#E8EBEF' },
        muted: { DEFAULT: '#5C636E', dark: '#9AA3AF' },
        line: { DEFAULT: '#DDE2E8', dark: '#2A303A' },
        // Darker than the app's old brand blue (#208AEF), which reached only
        // 3.53:1 against the white label it carries on a primary button and so
        // missed AA. This is the same blue, moved far enough to pass at 4.98:1.
        // #208AEF survives as the dark-mode value, where it sits on #0E1116.
        accent: { DEFAULT: '#0F6FD1', dark: '#5FA8F5' },
        // Chore health. Structural green/amber/red rather than the couple apps'
        // softened clay: a chore that is overdue is a fact to act on, not a
        // feeling to be gentle about.
        ontrack: { DEFAULT: '#2E7D57', dark: '#6FBF95' },
        duesoon: { DEFAULT: '#9A6608', dark: '#E0A94F' },
        overdue: { DEFAULT: '#C0392F', dark: '#E58074' },
      },
    },
  },
  plugins: [],
};
