/**
 * The colour names every app must define.
 *
 * `packages/ui` emits class names like `bg-canvas` and `text-ink-dark`. A name
 * Tailwind has no value for compiles to nothing at all — no error, no warning,
 * no type failure, just an unstyled component that looks like a layout bug.
 * That is the failure this list exists to make loud, via
 * `tests/guards/tokens.test.ts`.
 *
 * Plain CommonJS data, not TypeScript: a Tailwind config is CommonJS and has to
 * be able to require it.
 */
module.exports = {
  TOKEN_NAMES: [
    // Surfaces and text.
    'canvas',
    'surface',
    'ink',
    'muted',
    'line',
    'accent',
    // Cadence health. Required even in apps with no cadence UI yet — `CadenceBar`
    // is exported to every consumer, so every consumer has to be able to render it.
    'ontrack',
    'duesoon',
    'overdue',
  ],
};
