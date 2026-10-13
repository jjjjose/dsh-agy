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
function descriptor(id: string, name: string): Model<AntiGravityApi> {
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
    input: ['text'],
    cost: NO_COST,
    contextWindow: 32768,
    maxTokens: 8192,
  }
}

export const EFFORTS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export interface CapabilityLimit {
  value: number
  source: 'google' | 'cache' | 'fallback'
  verifiedAt?: number
}
export interface ModelCapabilities {
  contextWindow: CapabilityLimit
  maxOutputTokens: CapabilityLimit
  supportsImages?: boolean
  supportsVideo?: boolean
}
export interface ModelRoute { id: string; thinking?: Record<string, unknown>; capabilities?: ModelCapabilities }
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
  models: Array<{ id: string; name: string; contextWindow: CapabilityLimit; maxOutputTokens: CapabilityLimit;
    variants: Array<{ effort: string; id: string; capabilities: ModelCapabilities }> }>
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
  const suffix = /-(extra-low|off|minimal|low|medium|high|xhigh|max)$/.exec(id)
  const withoutEffort = suffix ? id.slice(0, -suffix[0].length) : id
  const thinking = family === 'claude' && withoutEffort.endsWith('-thinking')
  return { base: thinking ? withoutEffort.slice(0, -9) : withoutEffort, family, effort: (suffix?.[1] === 'extra-low' ? 'minimal' : suffix?.[1]) as ThinkingLevel | undefined, thinking }
}

/** Antigravity uses maxTokens for INPUT/context, never for max output. */
function capabilities(entry: Record<string, unknown>, source: 'google' | 'cache', now: number): ModelCapabilities {
  const cached = source === 'cache' && record(entry.capabilities) ? entry.capabilities : undefined
  const limit = (name: string, value: number | undefined, fallback: number): CapabilityLimit => {
    const stored = cached?.[name]
    if (record(stored) && positive(stored.value) && ['google', 'cache'].includes(String(stored.source))
      && typeof stored.verifiedAt === 'number' && stored.verifiedAt <= now && now - stored.verifiedAt <= 24 * 60 * 60_000) {
      return { value: stored.value as number, source: 'cache', verifiedAt: stored.verifiedAt }
    }
    // Cache v2 must not turn an operational fallback into a confirmed limit.
    if (source === 'cache') return { value: fallback, source: 'fallback' }
    return value === undefined ? { value: fallback, source: 'fallback' } : { value, source: 'google', verifiedAt: now }
  }
  return {
    contextWindow: limit('contextWindow', positive(entry.contextWindow) ?? positive(entry.maxInputTokens) ?? positive(entry.inputTokenLimit) ?? positive(entry.maxTokens), 32768),
    maxOutputTokens: limit('maxOutputTokens', positive(entry.maxOutputTokens) ?? positive(entry.outputTokenLimit), 8192),
    ...typeof entry.supportsImages === 'boolean' ? { supportsImages: entry.supportsImages } : {},
    ...typeof entry.supportsVideo === 'boolean' ? { supportsVideo: entry.supportsVideo } : {},
  }
}

export function modelLimits(model: DynamicModel): { contextWindow: CapabilityLimit; maxOutputTokens: CapabilityLimit } {
  const routes = Object.values(model.antigravity.routes)
  const smallest = (field: 'contextWindow' | 'maxOutputTokens', fallback: number): CapabilityLimit => {
    const known = routes.map((route) => route?.capabilities?.[field]).filter((value): value is CapabilityLimit => !!value && value.source !== 'fallback')
    return known.sort((a, b) => a.value - b.value)[0] ?? { value: fallback, source: 'fallback' }
  }
  return { contextWindow: smallest('contextWindow', 32768), maxOutputTokens: smallest('maxOutputTokens', 8192) }
}

export function applyModelCapabilities(model: DynamicModel): void {
  const limits = modelLimits(model)
  model.contextWindow = limits.contextWindow.value
  model.maxTokens = limits.maxOutputTokens.value
  model.input = Object.values(model.antigravity.routes).every((route) => route?.capabilities?.supportsImages === true) ? ['text', 'image'] : ['text']
}

/** Preserve still-fresh confirmed limits for the same account and wire route. */
export function retainModelCapabilities(models: readonly DynamicModel[], previous: readonly DynamicModel[], now: number): DynamicModel[] {
  const prior = new Map(previous.flatMap((model) => Object.values(model.antigravity.routes).map((route) => [route!.id, route!.capabilities] as const)))
  return models.map((model) => {
    const routes = Object.fromEntries(Object.entries(model.antigravity.routes).map(([effort, route]) => {
      const old = prior.get(route.id)
      const caps = route.capabilities
      if (!caps) return [effort, route]
      const keep = (field: 'contextWindow' | 'maxOutputTokens'): CapabilityLimit => {
        const last = old?.[field]
        if (caps[field].source !== 'fallback') return { ...caps[field], verifiedAt: now }
        return last && last.source !== 'fallback' && last.verifiedAt !== undefined && now >= last.verifiedAt && now - last.verifiedAt <= 24 * 60 * 60_000
          ? { ...last, source: 'cache' } : caps[field]
      }
      return [effort, { ...route, capabilities: { ...caps, contextWindow: keep('contextWindow'), maxOutputTokens: keep('maxOutputTokens') } }]
    }))
    const result = { ...model, antigravity: { ...model.antigravity, routes } }
    applyModelCapabilities(result)
    return result
  })
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
export function parseModelCatalog(payload: unknown, source: 'google' | 'cache' = 'google', now = Date.now()): { models: DynamicModel[]; ignoredCount: number } {
  if (!record(payload) || !record(payload.models)) throw new Error('Antigravity model response must contain a models object')
  if (Object.keys(payload.models).length > 2000) throw new Error('Antigravity model catalog is too large')
  const groups = new Map<string, DynamicModel>()
  let ignoredCount = 0
  const hidden = new Set(Array.isArray(payload.tieredModelIds) ? payload.tieredModelIds : [])
  // Sort for deterministic results even when Google's object order changes.
  for (const [id, entry] of Object.entries(payload.models).sort(([a], [b]) => a.localeCompare(b))) {
    let info = validId(id) ? identity(id) : undefined
    // Some agent routes have opaque aliases. Recover a versioned identity only
    // from an unambiguous Google display name; retain the original wire ID.
    if (!info && validId(id) && id.startsWith('gemini-') && record(entry) && typeof entry.displayName === 'string') {
      const named = /^Gemini (\d+(?:\.\d+)?) (Flash|Pro)(?: \((Low|Medium|High)\))?$/.exec(entry.displayName)
      if (named) info = { base: `gemini-${named[1]}-${named[2]!.toLowerCase()}`, family: 'gemini', thinking: false,
        effort: named[3]?.toLowerCase() as ThinkingLevel | undefined }
    }
    // The known shared backend route represents both 3.5 Flash effort variants.
    const shared = id === 'gemini-3-flash-agent'
    if ((!info && !shared) || !record(entry) || entry.isInternal === true || hidden.has(id) || id.endsWith('-tiered')) { ignoredCount++; continue }
    const base = shared ? 'gemini-3.5-flash' : info!.base
    const family = shared ? 'gemini' : info!.family
    let group = groups.get(base)
    if (!group) {
      const display = typeof entry.displayName === 'string' ? entry.displayName.replace(/\s*\((?:off|minimal|low|medium|high|xhigh|max|thinking)\)\s*$/i, '').replace(/\s+(?:low|medium|high)\s*$/i, '').trim().slice(0, 160) : ''
      group = { ...descriptor(base, display || modelName(base)), reasoning: false,
        antigravity: { routes: {}, aliases: {}, defaultEffort: 'default' } }
      groups.set(base, group)
    }
    const caps = capabilities(entry, source, now)
    const thinking = info?.thinking === true || (family === 'claude' && entry.supportsThinking === true)
    const declared = Array.isArray(entry.supportedThinkingLevels) ? entry.supportedThinkingLevels.filter((level): level is ThinkingLevel => EFFORTS.includes(level as ThinkingLevel)) : []
    const levels: Array<ThinkingLevel | 'default'> = shared ? ['medium', 'high'] : info?.effort ? [info.effort]
      : declared.length ? declared : thinking ? ['low', 'medium', 'high', 'xhigh', 'max'] : [family === 'claude' && entry.supportsThinking !== true ? 'off' : 'default']
    for (const level of levels) {
      // A concrete variant wins over a shared route/metadata-derived alternative.
      if (!group.antigravity.routes[level] || (info?.effort && identity(id)?.effort)) {
        const route = routeFor(id, family, level, thinking)
        // Google's extra-low route declares a budget, not a "minimal" enum.
        if (id.endsWith('-extra-low') && typeof entry.thinkingBudget === 'number' && entry.thinkingBudget >= 0) {
          route.thinking = { includeThoughts: true, thinkingBudget: entry.thinkingBudget }
        }
        if (level === 'default' && entry.supportsThinking === true && typeof entry.thinkingBudget === 'number' && (entry.thinkingBudget === -1 || entry.thinkingBudget >= 0)) {
          route.thinking = { includeThoughts: entry.thinkingBudget !== 0, thinkingBudget: entry.thinkingBudget }
        }
        group.antigravity.routes[level] = { ...route, capabilities: caps }
      }
    }
    group.antigravity.aliases[id] = info?.effort ?? (thinking ? 'high' : levels[0]!)
    if (shared) {
      group.antigravity.aliases['gemini-3.5-flash-medium'] = 'medium'
      group.antigravity.aliases['gemini-3.5-flash-high'] = 'high'
    }
  }
  for (const group of groups.values()) {
    applyModelCapabilities(group)
    const routes = group.antigravity.routes
    const cachedAliases = source === 'cache' && record(payload.aliases) ? payload.aliases[group.id] : undefined
    if (record(cachedAliases)) {
      for (const [alias, effort] of Object.entries(cachedAliases).slice(0, 2000)) {
        if (validId(alias) && typeof effort === 'string' && (effort === 'default' || EFFORTS.includes(effort as ThinkingLevel)) && routes[effort as ThinkingLevel | 'default']) {
          group.antigravity.aliases[alias] = effort as ThinkingLevel | 'default'
        }
      }
    }
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
    const route = model.antigravity.routes[effort]
    result.push({ ...model, id: alias, reasoning: offered.some((level) => level !== 'off'),
      contextWindow: route?.capabilities?.contextWindow.value ?? model.contextWindow,
      maxTokens: route?.capabilities?.maxOutputTokens.value ?? model.maxTokens,
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
