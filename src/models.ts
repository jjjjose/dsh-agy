/**
 * Antigravity model descriptors and live catalog reconciliation.
 *
 * The ids here are the exact `model` values Cloud Code Assist expects in the
 * inference envelope. The maintained list is intersected with the account's
 * `v1internal:fetchAvailableModels` response before display, so models Google
 * retires disappear automatically.
 */

import type { Model } from '@earendil-works/pi-ai'
import { ENDPOINTS, antiGravityHeaders } from './constants.ts'
import { resolveWireModel, responseFailure } from './transport-transform.ts'

/** pi-ai API identity owned by this provider. */
export type AntiGravityApi = 'google-antigravity'
/** Stable provider id registered with the Harness LLM service. */
export const PROVIDER = 'google-antigravity'

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
type Family = 'gemini' | 'claude' | 'gpt'
type Level = 'low' | 'medium' | 'high'

function descriptor(id: string, name: string, family: Family, level: Level): Model<AntiGravityApi> {
  const contextWindow = family === 'gemini' ? 1_048_576 : family === 'claude' ? 200_000 : 131_072
  const output = family === 'gpt' ? 8_192 : family === 'claude' ? 64_000 : 65_536
  return {
    id,
    name,
    api: 'google-antigravity',
    provider: PROVIDER,
    baseUrl: ENDPOINTS[0],
    reasoning: family !== 'claude' || id.includes('thinking'),
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: level === 'low' ? 'low' : null,
      medium: level === 'medium' ? 'medium' : null,
      high: level === 'high' ? 'high' : null,
      xhigh: null,
      max: null,
    },
    input: ['text', 'image'],
    cost: NO_COST,
    contextWindow,
    maxTokens: output,
  }
}

function flashRange(version: string): Model<AntiGravityApi>[] {
  return (['low', 'medium', 'high'] as Level[]).map((level) =>
    descriptor(`gemini-${version}-flash-${level}`, `Gemini ${version} Flash (${level})`, 'gemini', level))
}

/** Reviewed descriptors; the visible catalog is always reconciled online. */
export const maintainedModels: readonly Model<AntiGravityApi>[] = [
  ...flashRange('3.8'),
  ...flashRange('3.7'),
  ...flashRange('3.6'),
  ...flashRange('3.5'),
  descriptor('gemini-3.1-pro-high', 'Gemini 3.1 Pro (High)', 'gemini', 'high'),
  descriptor('gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)', 'gemini', 'low'),
  descriptor('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'claude', 'high'),
  {
    ...descriptor('claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)', 'claude', 'high'),
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
  descriptor('gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)', 'gpt', 'medium'),
]

interface AvailableModelsResponse {
  models?: Record<string, { displayName?: unknown }>
}

/**
 * Reconcile the maintained descriptors with one `fetchAvailableModels` payload.
 * @param payload - decoded Cloud Code Assist response body.
 * @returns maintained descriptors that also appear in the response.
 */
export function parseAvailableModels(payload: unknown): readonly Model<AntiGravityApi>[] {
  if (typeof payload !== 'object' || payload === null || typeof (payload as AvailableModelsResponse).models !== 'object' || (payload as AvailableModelsResponse).models === null || Array.isArray((payload as AvailableModelsResponse).models)) {
    throw new Error('Antigravity model response must contain a models object')
  }
  const live = (payload as Required<AvailableModelsResponse>).models
  return maintainedModels.flatMap((model) => {
    const entry = live[model.id] ?? live[resolveWireModel(model.id).id]
    if (typeof entry !== 'object' || entry === null) return []
    const name = typeof entry.displayName === 'string' && entry.displayName.length > 0 ? entry.displayName : model.name
    return [{ ...model, name }]
  })
}

/**
 * Fetch the account-authorized model list.
 * @param access - current OAuth access token.
 * @param projectId - Cloud Code Assist companion project id.
 * @param signal - optional cancellation signal.
 * @returns reviewed account-visible descriptors.
 */
export async function fetchAvailableModels(
  access: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly Model<AntiGravityApi>[]> {
  let lastStatus: number | undefined
  for (const endpoint of ENDPOINTS) {
    const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
      method: 'POST',
      headers: antiGravityHeaders(access),
      body: JSON.stringify({ project: projectId }),
      ...signal === undefined ? {} : { signal },
    })
    if (response.ok) {
      const models = parseAvailableModels(await response.json())
      if (models.length === 0) throw new Error('Antigravity returned no maintained models')
      return models
    }
    lastStatus = response.status
    await responseFailure(response)
    if (![404, 500, 502, 503, 504].includes(response.status)) break
  }
  throw new Error(`Antigravity model discovery failed with HTTP ${lastStatus ?? 'unknown'}`)
}
