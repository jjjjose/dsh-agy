/**
 * Dynamic Antigravity descriptors: one visible identity, account-specific routes
 * per effort. Compatible new versions require no maintained version allowlist.
 */

import type { Model, ModelThinkingLevel as ThinkingLevel } from '@earendil-works/pi-ai'
import { ENDPOINTS, antiGravityHeaders } from './constants.ts'
import { resolveWireModel, responseFailure } from './transport-transform.ts'

/** pi-ai API identity owned by this provider. */
export type AntiGravityApi = 'google-antigravity'
/** Stable provider id registered with the Harness LLM service. */
export const PROVIDER = 'google-antigravity'

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
type Family = 'gemini' | 'claude' | 'gpt'
function descriptor(id: string, name: string, family: Family): Model<AntiGravityApi> {
  const contextWindow = family === 'gemini' ? 1_048_576 : family === 'claude' ? 200_000 : 131_072
  const output = family === 'gpt' ? 8_192 : family === 'claude' ? 64_000 : 65_536
  return {
    id,
    name,
    api: 'google-antigravity',
    provider: PROVIDER,
    baseUrl: ENDPOINTS[0],
    reasoning: false,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: null,
      max: null,
    },
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow,
    maxTokens: output,
  }
}

export const EFFORTS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export interface ModelRoute { id: string; thinking?: Record<string, unknown> }
export class ModelSelectionError extends Error {}
export interface DynamicModel extends Model<AntiGravityApi> {
  antigravity: { routes: Partial<Record<ThinkingLevel | 'default', ModelRoute>>; aliases: Record<string, ThinkingLevel | 'default'>; defaultEffort: ThinkingLevel | 'default' }
}
export interface CatalogStatus {
  source: 'google' | 'cache' | 'unavailable'
  updatedAt: number | null
  modelCount: number
  variantCount: number
  ignoredCount: number
  refreshing: boolean
  error?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)
const positive = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

function identity(id: string): { base: string; family: Family; effort?: ThinkingLevel; thinking: boolean } | undefined {
  if (/image|imagen|embedding|tts|audio|video/i.test(id)) return undefined
  const family: Family | undefined = /^gemini-\d/.test(id) ? 'gemini' : /^claude-(?:sonnet|opus|haiku)-/.test(id) ? 'claude' : /^gpt-oss-\d+b/i.test(id) ? 'gpt' : undefined
  if (!family) return undefined
  const suffix = /-(off|minimal|low|medium|high|xhigh|max)$/.exec(id)
  const withoutEffort = suffix ? id.slice(0, -suffix[0].length) : id
  const thinking = family === 'claude' && withoutEffort.endsWith('-thinking')
  return { base: thinking ? withoutEffort.slice(0, -9) : withoutEffort, family, effort: suffix?.[1] as ThinkingLevel | undefined, thinking }
}

function modelName(id: string): string {
  return id.replace(/^gemini-/, 'Gemini ').replace(/^claude-(sonnet|opus|haiku)-/, (_, tier: string) => `Claude ${tier[0]!.toUpperCase()}${tier.slice(1)} `)
    .replace(/^gpt-oss-/, 'GPT-OSS ').replace(/(\d+)-(\d+)(?=$|-)/, '$1.$2')
    .replace(/\bflash\b/g, 'Flash').replace(/\bpro\b/g, 'Pro').replace(/(\d+)b\b/gi, '$1B').replace(/-/g, ' ').replace(/^GPT OSS /, 'GPT-OSS ')
}

function routeFor(id: string, family: Family, effort: ThinkingLevel | 'default', thinking: boolean): ModelRoute {
  if (effort === 'off' && (family === 'gemini' || (family === 'claude' && thinking))) return { id, thinking: { includeThoughts: false, thinkingBudget: 0 } }
  if (family === 'gemini' && effort !== 'default' && effort !== 'off') return { id, thinking: { includeThoughts: true, thinkingLevel: effort } }
  if (family === 'claude' && thinking && effort !== 'default' && effort !== 'off') {
    const budgets: Partial<Record<ThinkingLevel, number>> = { minimal: 1024, low: 8192, medium: 16384, high: 32768, xhigh: 32768, max: 32768 }
    return { id, thinking: { includeThoughts: true, thinkingBudget: budgets[effort] } }
  }
  return { id }
}

/** Parse all compatible versions returned by Google, not a fixed allowlist. */
export function parseModelCatalog(payload: unknown): { models: DynamicModel[]; ignoredCount: number } {
  if (!record(payload) || !record(payload.models)) throw new Error('Antigravity model response must contain a models object')
  if (Object.keys(payload.models).length > 2000) throw new Error('Antigravity model catalog is too large')
  const groups = new Map<string, DynamicModel>()
  let ignoredCount = 0
  // Sort for deterministic results even when Google's object order changes.
  for (const [id, entry] of Object.entries(payload.models).sort(([a], [b]) => a.localeCompare(b))) {
    const info = validId(id) ? identity(id) : undefined
    // The known shared backend route represents both 3.5 Flash effort variants.
    const shared = id === 'gemini-3-flash-agent'
    if ((!info && !shared) || !record(entry)) { ignoredCount++; continue }
    const base = shared ? 'gemini-3.5-flash' : info!.base
    const family = shared ? 'gemini' : info!.family
    let group = groups.get(base)
    if (!group) {
      const display = typeof entry.displayName === 'string' ? entry.displayName.replace(/\s*\((?:off|minimal|low|medium|high|xhigh|max|thinking)\)\s*$/i, '').replace(/\s+(?:low|medium|high)\s*$/i, '').trim().slice(0, 160) : ''
      group = { ...descriptor(base, display || modelName(base), family), reasoning: false,
        // Missing limits use conservative adapter defaults, not claimed capabilities.
        contextWindow: positive(entry.contextWindow) ?? positive(entry.maxInputTokens) ?? 32768,
        maxTokens: positive(entry.maxOutputTokens) ?? positive(entry.maxTokens) ?? 8192,
        input: entry.supportsImages === true ? ['text', 'image'] : ['text'],
        antigravity: { routes: {}, aliases: {}, defaultEffort: 'default' } }
      groups.set(base, group)
    }
    // Group limits/modalities are safe for every route in the group.
    group.contextWindow = Math.min(group.contextWindow, positive(entry.contextWindow) ?? positive(entry.maxInputTokens) ?? 32768)
    group.maxTokens = Math.min(group.maxTokens, positive(entry.maxOutputTokens) ?? positive(entry.maxTokens) ?? 8192)
    if (entry.supportsImages !== true) group.input = ['text']
    const thinking = info?.thinking === true || (family === 'claude' && entry.supportsThinking === true)
    const declared = Array.isArray(entry.supportedThinkingLevels) ? entry.supportedThinkingLevels.filter((level): level is ThinkingLevel => EFFORTS.includes(level as ThinkingLevel)) : []
    const levels: Array<ThinkingLevel | 'default'> = shared ? ['medium', 'high'] : info?.effort ? [info.effort]
      : declared.length ? declared : thinking ? ['low', 'medium', 'high', 'xhigh', 'max'] : [family === 'claude' && entry.supportsThinking !== true ? 'off' : 'default']
    for (const level of levels) {
      // A concrete variant wins over a shared route/metadata-derived alternative.
      if (!group.antigravity.routes[level] || info?.effort) group.antigravity.routes[level] = routeFor(id, family, level, thinking)
    }
    group.antigravity.aliases[id] = info?.effort ?? (thinking ? 'high' : levels[0]!)
    if (shared) {
      group.antigravity.aliases['gemini-3.5-flash-medium'] = 'medium'
      group.antigravity.aliases['gemini-3.5-flash-high'] = 'high'
    }
  }
  for (const group of groups.values()) {
    const routes = group.antigravity.routes
    // DSH translates explicit Off into an omitted reasoning option. Therefore
    // an offered Off route must also be the provider default, or Off would think.
    group.antigravity.defaultEffort = (['off', 'medium', 'high', 'low', 'xhigh', 'max', 'minimal', 'default'] as const).find((level) => routes[level])!
    const levels = EFFORTS.filter((effort) => routes[effort])
    group.reasoning = levels.some((level) => level !== 'off')
    group.thinkingLevelMap = Object.fromEntries(EFFORTS.map((level) => [level, routes[level] ? level : null]))
  }
  const familyOrder = (id: string) => id.startsWith('gemini-') ? 0 : id.startsWith('claude-') ? 1 : 2
  const models = [...groups.values()].sort((a, b) => familyOrder(a.id) - familyOrder(b.id) || b.id.localeCompare(a.id, undefined, { numeric: true }))
  // Display-name collisions never merge independent model identities.
  const names = new Map<string, number>()
  for (const model of models) names.set(model.name, (names.get(model.name) ?? 0) + 1)
  for (const model of models) if ((names.get(model.name) ?? 0) > 1) model.name = modelName(model.id)
  return { models, ignoredCount }
}

export function selectedModelEffort(model: Model<AntiGravityApi>, effort?: ThinkingLevel): ThinkingLevel | 'default' {
  return effort ?? (model as DynamicModel).antigravity?.defaultEffort ?? 'default'
}

export function selectModelRoute(model: Model<AntiGravityApi>, effort?: ThinkingLevel | 'default'): ModelRoute {
  const dynamic = model as DynamicModel
  if (!dynamic.antigravity) return resolveWireModel(model.id)
  const selected = effort ?? dynamic.antigravity.defaultEffort
  const route = dynamic.antigravity.routes[selected]
    ?? (selected === 'off' && !model.reasoning ? dynamic.antigravity.routes.default : undefined)
  if (!route) throw new ModelSelectionError(`Antigravity model ${model.id} does not offer effort ${selected}. Refresh models and select an available effort.`)
  return route
}

/** Hidden descriptors keep old selections usable without duplicating the picker. */
export function withLegacyAliases(models: readonly DynamicModel[]): DynamicModel[] {
  const result = [...models]
  const ids = new Set(models.map((model) => model.id))
  for (const model of models) for (const [alias, effort] of Object.entries(model.antigravity.aliases)) {
    if (ids.has(alias)) continue
    ids.add(alias)
    const offered = effort === 'default' ? [] : [effort]
    result.push({ ...model, id: alias, reasoning: offered.some((level) => level !== 'off'),
      thinkingLevelMap: Object.fromEntries(EFFORTS.map((level) => [level, offered.includes(level) ? level : null])),
      antigravity: { ...model.antigravity, defaultEffort: effort } })
  }
  return result
}

/**
 * Group one `fetchAvailableModels` payload into selectable identities.
 * @param payload - decoded Cloud Code Assist response body.
 * @returns compatible dynamic descriptors and their real effort routes.
 */
export function parseAvailableModels(payload: unknown): readonly DynamicModel[] {
  return parseModelCatalog(payload).models
}

export class ModelDiscoveryError extends Error {
  constructor(readonly status: number) { super(`Antigravity model discovery failed with HTTP ${status}`) }
}

/**
 * Fetch the account-authorized model list.
 * @param access - current OAuth access token.
 * @param projectId - Cloud Code Assist companion project id.
 * @param signal - optional cancellation signal.
 * @returns account-visible dynamic descriptors.
 */
export async function fetchAvailableModels(
  access: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly DynamicModel[]> {
  return (await discoverModelCatalog(access, projectId, signal)).models
}

export async function discoverModelCatalog(access: string, projectId: string, signal?: AbortSignal): Promise<{ models: DynamicModel[]; ignoredCount: number }> {
  let lastStatus: number | undefined
  for (const endpoint of ENDPOINTS) {
    const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
      method: 'POST',
      headers: antiGravityHeaders(access),
      body: JSON.stringify({ project: projectId }),
      ...signal === undefined ? {} : { signal },
    })
    if (response.ok) {
      return parseModelCatalog(await response.json())
    }
    lastStatus = response.status
    await responseFailure(response)
    if (![404, 500, 502, 503, 504].includes(response.status)) break
  }
  throw new ModelDiscoveryError(lastStatus ?? 0)
}
