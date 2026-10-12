import { describe, expect, it, vi } from 'vitest'
import { registerTools } from '../src/tools.ts'
import { EngineStats } from '../src/stats.ts'
import type { AccountManager } from '../src/manager.ts'
import type { DshContext } from '../src/dsh-context.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

describe('native DSH agent tools', () => {
  it('registers canonical JSON tools, renders output and disposes every registration', async () => {
    const definitions: Array<ToolDefinition<unknown, { report: string }>> = []
    const dispose = vi.fn()
    const tools = { register: (definition: unknown) => { definitions.push(definition as ToolDefinition<unknown, { report: string }>); return dispose } } as DshContext['tools']
    const cleanup = registerTools(tools, { quotaAccounts: async () => [] } as unknown as AccountManager, new EngineStats())
    expect(definitions.map((tool) => tool.name)).toEqual(['antigravity_quota', 'antigravity_stats', 'google_search'])
    const stats = definitions.find((tool) => tool.name === 'antigravity_stats')!
    const value = await stats.execute({}, { signal: new AbortController().signal })
    expect(value).toHaveProperty('report')
    expect(stats.output.render({}, value)).toEqual([{ type: 'text', text: value.report }])
    cleanup()
    expect(dispose).toHaveBeenCalledTimes(3)
  })
  it('does not resolve credentials after cancellation', async () => {
    let search!: ToolDefinition<{ query: string }, { report: string }>
    const tools = { register: (definition: unknown) => { const tool = definition as typeof search; if (tool.name === 'google_search') search = tool; return () => {} } } as DshContext['tools']
    const resolveAuth = vi.fn()
    registerTools(tools, { resolveAuth } as unknown as AccountManager, new EngineStats())
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(search.execute({ query: 'query' }, { signal: controller.signal })).rejects.toThrow('cancelled')
    expect(resolveAuth).not.toHaveBeenCalled()
  })
})
