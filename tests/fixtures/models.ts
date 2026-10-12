import { parseAvailableModels, withLegacyAliases } from '../../src/models.ts'

/** Concrete legacy IDs are test fixtures, never the production picker catalog. */
export const transportModels = withLegacyAliases(parseAvailableModels({ models: {
  'gemini-3.8-flash-high': { supportsImages: true },
  'gemini-3.1-pro-high': { supportsImages: true },
  'claude-opus-4-6-thinking': { supportsImages: true, maxOutputTokens: 64000 },
} }))
