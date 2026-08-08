/**
 * Everything the apps' Tailwind configs agree on — which is everything except
 * the palette.
 *
 * Colours stay in each app because they are the one thing the apps genuinely
 * disagree about: the couple apps are warm and evening-lit, and a chores app is
 * a utility. A preset cannot carry a colour *name* without also carrying a
 * value, and a placeholder value is worse than nothing — an app that forgot to
 * override it would ship the placeholder silently. So the names live in
 * `tokens.js` as data, and `tests/guards/tokens.test.ts` enforces that every
 * app defines all of them.
 *
 * `content` is deliberately NOT here. Tailwind does not merge `content` across
 * presets — an app's array replaces the preset's outright, silently. Putting
 * the scan path here would look like it worked and would in fact stop
 * `packages/ui` from ever being scanned, which unstyles every shared component
 * with no error anywhere. So each app keeps its own `../../packages/ui/src/**`
 * entry, and `tests/guards/tokens.test.ts` asserts it is still there.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  presets: [require('nativewind/preset')],
  darkMode: 'media',
};
