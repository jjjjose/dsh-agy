import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DshContext } from './dsh-context.ts'
import type { AccountManager } from './manager.ts'
import type { EngineStats } from './stats.ts'
import { fetchAccountQuota, formatQuotaReport } from './quota.ts'
import type { AccountQuotaResult } from './types.ts'
import { executeSearch } from './search.ts'

const output = {
  schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
  render: (_args: unknown, value: { report: string }) => [{ type: 'text' as const, text: value.report }],
}

export async function quotaReport(manager: AccountManager, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const accounts = await manager.quotaAccounts()
  const results: AccountQuotaResult[] = []
  for (const account of accounts) {
    signal?.throwIfAborted()
    if (!account.enabled || !account.access) {
      results.push({ accountId: account.id, email: account.email, status: account.enabled ? 'error' : 'disabled', buckets: [], error: account.enabled ? 'token unavailable' : undefined })
      continue
    }
    results.push(await fetchAccountQuota({ id: account.id, email: account.email, refreshToken: '', projectId: account.projectId, addedAt: 0, lastUsed: 0, enabled: true }, account.access, signal))
  }
  signal?.throwIfAborted()
  return formatQuotaReport(results)
}

/** DSH tools return canonical JSON; rendering supplies the model-visible text. */
export function registerTools(tools: DshContext['tools'], manager: AccountManager, stats: EngineStats): () => void {
  const disposers: Array<() => void> = []
  try {
    disposers.push(tools.register(defineTool({
      name: 'antigravity_quota',
      description: 'Check Google Antigravity account quota, including five-hour and weekly windows.',
      parameters: {}, output,
      execute: async (_args: Record<string, never>, context) => ({ report: await quotaReport(manager, context.signal) }),
    })))
    disposers.push(tools.register(defineTool({
      name: 'antigravity_stats', description: 'Show Antigravity runtime request and account activity. No credentials are returned.',
      parameters: {}, output,
      execute: async (_args: Record<string, never>, context) => {
        context.signal.throwIfAborted()
        return { report: JSON.stringify(stats.snapshot(), null, 2) }
      },
    })))
    disposers.push(tools.register(defineTool({
      name: 'google_search', description: 'Search Google and analyze optional URLs, returning an answer with source citations.',
      parameters: {
        query: { type: 'string', required: true, description: 'The search query' },
        urls: { type: 'array', items: { type: 'string' }, description: 'HTTP(S) URLs to analyze' },
        thinking: { type: 'boolean', description: 'Enable additional reasoning (default true)' },
      }, output,
      execute: async (args: { query: string; urls?: string[]; thinking?: boolean }, context) => {
        context.signal.throwIfAborted()
        if (!args.query.trim() || args.query.length > 10000) throw new Error('Search query must contain 1–10000 characters')
        if (args.urls && (args.urls.length > 20 || args.urls.some((url) => !/^https?:\/\//i.test(url)))) throw new Error('Provide at most 20 HTTP(S) URLs')
        const auth = await manager.resolveAuth()
        context.signal.throwIfAborted()
        return { report: await executeSearch(args, auth.token, auth.projectId, context.signal) }
      },
    })))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.splice(0).reverse()) dispose() }
}
