/**
 * Google Search grounding tool. Native search tools cannot be combined with
 * function declarations, so this runs a separate grounding-only request.
 */

import { ENDPOINTS, SEARCH_MODEL, SEARCH_SYSTEM_INSTRUCTION, SEARCH_TIMEOUT_MS, antiGravityHeaders } from './constants.ts'

export interface SearchArgs {
  query: string
  urls?: string[]
  thinking?: boolean
}

interface GroundingChunk { web?: { uri?: string; title?: string } }
interface SearchCandidate {
  content?: { parts?: Array<{ text?: string }> }
  groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: GroundingChunk[] }
  urlContextMetadata?: { url_metadata?: Array<{ retrieved_url?: string; url_retrieval_status?: string }> }
}
interface SearchResponse {
  response?: { candidates?: SearchCandidate[]; error?: { message?: string } }
  error?: { message?: string }
}

let sessionCounter = 0
const sessionPrefix = `search-${Date.now().toString(36)}`
function requestId(): string {
  return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parseAndFormat(data: SearchResponse): string {
  const response = data.response
  const candidate = response?.candidates?.[0]
  if (!candidate) {
    const message = data.error?.message ?? response?.error?.message ?? 'No results'
    return `## Search Error\n\n${message}`
  }
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').filter(Boolean).join('\n')
  const lines: string[] = ['## Search Results', '', text, '']
  const queries = candidate.groundingMetadata?.webSearchQueries ?? []
  const chunks = candidate.groundingMetadata?.groundingChunks ?? []
  if (chunks.length > 0) {
    lines.push('### Sources')
    for (const chunk of chunks) {
      if (chunk.web?.uri && chunk.web?.title) lines.push(`- [${chunk.web.title}](${chunk.web.uri})`)
    }
    lines.push('')
  }
  if (queries.length > 0) {
    lines.push('### Queries')
    for (const q of queries) lines.push(`- "${q}"`)
  }
  return lines.join('\n').trimEnd()
}

/**
 * Execute a grounding-only Google Search.
 * @param args - query, optional URLs to analyze, and thinking flag.
 * @param access - current OAuth access token.
 * @param projectId - Cloud Code Assist companion project id.
 * @param signal - optional cancellation signal.
 * @returns formatted markdown results.
 */
export async function executeSearch(
  args: SearchArgs,
  access: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<string> {
  const { query, urls } = args
  let prompt = query
  if (urls && urls.length > 0) prompt = `${query}\n\nURLs to analyze:\n${urls.join('\n')}`
  const tools: Array<Record<string, unknown>> = [{ googleSearch: {} }]
  if (urls && urls.length > 0) tools.push({ urlContext: {} })

  const payload = {
    project: projectId,
    model: SEARCH_MODEL,
    userAgent: 'antigravity',
    requestId: requestId(),
    request: {
      systemInstruction: { parts: [{ text: SEARCH_SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools,
      generationConfig: { temperature: 0, topP: 1 },
      sessionId: `${sessionPrefix}-${++sessionCounter}`,
    },
  }

  let lastError = ''
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: 'POST',
        headers: antiGravityHeaders(access),
        body: JSON.stringify(payload),
        signal: signal ?? AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      })
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break
        continue
      }
      return parseAndFormat((await response.json()) as SearchResponse)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return `## Search Error\n\nSearch failed (${lastError}). Try a different query.`
}
