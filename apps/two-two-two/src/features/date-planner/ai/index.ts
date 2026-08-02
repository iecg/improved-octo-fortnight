/**
 * The feature's only entrance.
 *
 * Screens import from here and nowhere deeper, which is what keeps the two
 * service names — and every assumption that a model exists — inside this
 * directory. `tests/guards/ai-optional.test.ts` enforces that; this barrel is
 * what makes obeying it easy.
 */
export { AiKeyCard } from './AiKeyCard';
export { AiSuggestionCard } from './AiSuggestionCard';
export type { SuggestedIdea } from './parse';

import enAi from './locales/en/ai.json';
import esAi from './locales/es/ai.json';

/** Registered by `runtime.ts`, unconditionally: the strings must exist before a key does. */
export const AI_NAMESPACE = 'ai';
export const aiBundles = { en: enAi, es: esAi };
