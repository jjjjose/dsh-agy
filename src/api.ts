/**
 * Cloud Code Assist streaming transport for Antigravity.
 *
 * Builds the `{project, model, request, requestType, userAgent, requestId}`
 * envelope, POSTs to `v1internal:streamGenerateContent?alt=sse`, and converts
 * the SSE stream into pi-ai assistant events while preserving thought
 * signatures. On a rate-limit response it marks the account and retries once
 * with the next available account from the pool.
 */

import { calculateCost, createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context as PiContext,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai'
import { convertMessages, convertTools, isThinkingPart, mapStopReasonString, retainThoughtSignature } from '@earendil-works/pi-ai/api/google-shared'
import { ENDPOINTS, antiGravityHeaders } from './constants.ts'
import type { AntiGravityApi } from './models.ts'
import { cleanContents, cleanSchema, readSse, resolveWireModel, responseFailure } from './transport-transform.ts'

/** Per-request auth handed to the transport, including the owning account. */
export interface RequestAuth {
  token: string
  projectId: string
  accountId: string
}

/** Rotation-aware auth source supplied by the account manager. */
export interface AuthProvider {
  /** Next distinct auth after `accountId` was rate-limited, if any. */
  afterRateLimit(accountId: string): Promise<RequestAuth | undefined>
  reportRateLimit(accountId: string, delay?: number): void
  reportSuccess(accountId: string): void
  reportError?(accountId: string): void
}

interface ResponsePart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> }
}
interface ResponseChunk {
  error?: { message?: string; status?: string }
  response?: {
    responseId?: string
    candidates?: Array<{ content?: { parts?: ResponsePart[] }; finishReason?: string }>
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      thoughtsTokenCount?: number
      cachedContentTokenCount?: number
      totalTokenCount?: number
    }
  }
}

/** Parse the request-level auth JSON produced by the account manager. */
export function parseRequestAuth(value: string | undefined): RequestAuth {
  if (value === undefined) throw new Error('Antigravity requires OAuth authentication')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Antigravity OAuth request credential is invalid')
  }
  if (typeof parsed !== 'object' || parsed === null
    || typeof (parsed as { token?: unknown }).token !== 'string'
    || typeof (parsed as { projectId?: unknown }).projectId !== 'string') {
    throw new Error('Antigravity OAuth request credential is incomplete')
  }
  const record = parsed as RequestAuth
  return { ...record, accountId: typeof record.accountId === 'string' ? record.accountId : '' }
}

/** Build the Cloud Code Assist inference envelope for one request. */
export function buildEnvelope(
  model: Model<AntiGravityApi>,
  context: PiContext,
  options: StreamOptions,
  projectId: string,
): Record<string, unknown> {
  const googleModel = model as unknown as Model<'google-generative-ai'>
  const history: PiContext = {
    ...context,
    messages: context.messages.map((message) => message.role === 'assistant'
      ? { ...message, content: message.content.filter((part) => part.type !== 'thinking' || (!model.id.startsWith('claude-') && message.model === model.id && message.provider === model.provider)) }
      : message),
  }
  const request: Record<string, unknown> = {
    contents: cleanContents(convertMessages(googleModel, history), model.id.startsWith('claude-')),
    ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
  }
  if (context.systemPrompt !== undefined) {
    request.systemInstruction = { role: 'user', parts: [{ text: context.systemPrompt }] }
  }
  const generationConfig: Record<string, unknown> = {}
  const wire = resolveWireModel(model.id)
  if (wire.thinking) generationConfig.thinkingConfig = wire.thinking
  const reasoning = (options as SimpleStreamOptions).reasoning
  if (model.id.includes('claude-') && model.id.includes('thinking') && reasoning !== undefined) {
    const budgets: Record<string, number> = { off: 0, minimal: 1024, low: 8192, medium: 16384, high: 32768, xhigh: 32768, max: 32768 }
    const custom = (options as SimpleStreamOptions).thinkingBudgets
    const budget = (custom as Record<string, number> | undefined)?.[reasoning] ?? budgets[reasoning] ?? 16384
    generationConfig.thinkingConfig = { includeThoughts: budget > 0, thinkingBudget: Math.min(budget, Math.max(0, (options.maxTokens ?? model.maxTokens) - 1)) }
  }
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature
  if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig
  if (context.tools !== undefined && context.tools.length > 0) {
    request.tools = convertTools(context.tools, model.id.startsWith('claude-'))
    request.tools = (request.tools as Array<{ functionDeclarations?: Array<Record<string, unknown>> }>).map((tool) => ({
      ...tool,
      functionDeclarations: tool.functionDeclarations?.map((declaration) => ({
        ...declaration,
        ...declaration.parameters === undefined ? {} : { parameters: cleanSchema(declaration.parameters) },
        ...declaration.parametersJsonSchema === undefined ? {} : { parametersJsonSchema: cleanSchema(declaration.parametersJsonSchema) },
      })),
    }))
  }
  return {
    project: projectId,
    model: wire.id,
    request,
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: `agent-${crypto.randomUUID()}`,
  }
}

/** Open an SSE response, retrying across endpoints and rate-limited accounts. */
async function openResponse(
  model: Model<AntiGravityApi>,
  context: PiContext,
  options: StreamOptions,
  auth: RequestAuth,
  provider: AuthProvider,
): Promise<{ response: Response; auth: RequestAuth }> {
  let current = auth
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted()
    let payload = buildEnvelope(model, context, options, current.projectId)
    const replacement = await options.onPayload?.(payload, model)
    if (replacement != null) payload = replacement as Record<string, unknown>
    const body = JSON.stringify(payload)
    let failure: Awaited<ReturnType<typeof responseFailure>> | undefined
    for (const endpoint of ENDPOINTS) {
      const headers = {
        ...Object.fromEntries(Object.entries(options.headers ?? {}).filter((e): e is [string, string] => e[1] !== null)),
        ...antiGravityHeaders(current.token),
        .../^gemini-3\.[78]-flash/.test(model.id) ? { 'User-Agent': 'antigravity/cli/1.2.7 (aidev_client; os_type=linux; arch=amd64; cl=962369648; auth_method=consumer)' } : {},
        accept: 'text/event-stream',
        ...model.id.startsWith('claude-') ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {},
      }
      let response: Response
      try {
        response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
          method: 'POST', headers, body,
          ...options.signal === undefined ? {} : { signal: options.signal },
        })
      } catch (error) {
        options.signal?.throwIfAborted()
        failure = { message: error instanceof Error ? error.message : String(error), rateLimited: false }
        continue
      }
      const headerRecord = Object.fromEntries(response.headers as unknown as Iterable<[string, string]>)
      try { await options.onResponse?.({ status: response.status, headers: headerRecord }, model) }
      catch (error) { await response.body?.cancel(); throw error }
      if (response.ok) {
        return { response, auth: current }
      }
      failure = await responseFailure(response)
      if (failure.rateLimited || ![404, 500, 502, 503, 504].includes(response.status)) break
    }
    // Rate-limited or retryable: rotate to the next account if available.
    if (current.accountId && failure?.rateLimited) {
      provider.reportRateLimit(current.accountId, failure.delay)
      const next = await provider.afterRateLimit(current.accountId)
      if (next) {
        current = next
        continue
      }
    }
    throw new Error(`Antigravity inference failed with ${failure?.message ?? 'unknown error'}`)
  }
  throw new Error('Antigravity inference failed after exhausting retries')
}

/**
 * Native provider stream backed by Cloud Code Assist SSE.
 * @param model - selected Antigravity model descriptor.
 * @param context - system prompt, history, and tools for this request.
 * @param options - pi-ai transport, credential, and cancellation options.
 * @param provider - rotation-aware auth source.
 * @returns assistant event stream.
 */
export function streamAntiGravity(
  model: Model<AntiGravityApi>,
  context: PiContext,
  options: StreamOptions,
  provider: AuthProvider,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
  void (async () => {
    let requestAccountId = ''
    try {
      const auth = parseRequestAuth(options.apiKey)
      requestAccountId = auth.accountId
      const opened = await openResponse(model, context, options, auth, provider)
      requestAccountId = opened.auth.accountId
      const response = opened.response
      if (response.body === null) throw new Error('Antigravity returned no response stream')
      let started = false
      let current: TextContent | ThinkingContent | undefined
      const ensureStarted = (): void => {
        if (started) return
        started = true
        stream.push({ type: 'start', partial: output })
      }
      const closeCurrent = (): void => {
        if (current === undefined) return
        const index = output.content.length - 1
        if (current.type === 'text') stream.push({ type: 'text_end', contentIndex: index, content: current.text, partial: output })
        else stream.push({ type: 'thinking_end', contentIndex: index, content: current.thinking, partial: output })
        current = undefined
      }
      const consume = (chunk: ResponseChunk): void => {
        if (chunk.error) throw new Error(chunk.error.message ?? chunk.error.status ?? 'Antigravity stream error')
        const data = chunk.response
        if (data === undefined) return
        if (output.responseId === undefined && data.responseId !== undefined) output.responseId = data.responseId
        const candidate = data.candidates?.[0]
        for (const part of candidate?.content?.parts ?? []) {
          if (part.text === undefined && part.thoughtSignature !== undefined && current?.type === 'thinking') {
            current.thinkingSignature = part.thoughtSignature
          }
          if (part.text !== undefined) {
            const thinking = isThinkingPart(part)
            let active = current
            if (current === undefined || (thinking && current.type !== 'thinking') || (!thinking && current.type !== 'text')) {
              closeCurrent()
              const created: TextContent | ThinkingContent = thinking
                ? { type: 'thinking', thinking: '', ...part.thoughtSignature === undefined ? {} : { thinkingSignature: part.thoughtSignature } }
                : { type: 'text', text: '' }
              current = created
              active = created
              output.content.push(created)
              ensureStarted()
              const index = output.content.length - 1
              stream.push(thinking ? { type: 'thinking_start', contentIndex: index, partial: output } : { type: 'text_start', contentIndex: index, partial: output })
            }
            const index = output.content.length - 1
            if (active === undefined) throw new Error('Antigravity stream block was not initialized')
            if (active.type === 'thinking') {
              active.thinking += part.text
              const signature = retainThoughtSignature(active.thinkingSignature, part.thoughtSignature)
              if (signature !== undefined) active.thinkingSignature = signature
              stream.push({ type: 'thinking_delta', contentIndex: index, delta: part.text, partial: output })
            } else {
              active.text += part.text
              stream.push({ type: 'text_delta', contentIndex: index, delta: part.text, partial: output })
            }
          }
          if (part.functionCall !== undefined) {
            closeCurrent()
            const toolCall: ToolCall = {
              type: 'toolCall',
              id: part.functionCall.id ?? `${part.functionCall.name ?? 'tool'}_${crypto.randomUUID()}`,
              name: part.functionCall.name ?? '',
              arguments: part.functionCall.args ?? {},
              ...part.thoughtSignature === undefined ? {} : { thoughtSignature: part.thoughtSignature },
            }
            output.content.push(toolCall)
            ensureStarted()
            const index = output.content.length - 1
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: output })
            stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(toolCall.arguments), partial: output })
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial: output })
          }
        }
        if (candidate?.finishReason !== undefined) output.stopReason = mapStopReasonString(candidate.finishReason)
        if (output.content.some((block) => block.type === 'toolCall')) output.stopReason = 'toolUse'
        const usage = data.usageMetadata
        if (usage !== undefined) {
          const cacheRead = usage.cachedContentTokenCount ?? 0
          output.usage = {
            input: Math.max(0, (usage.promptTokenCount ?? 0) - cacheRead),
            output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            reasoning: usage.thoughtsTokenCount ?? 0,
            cacheRead,
            cacheWrite: 0,
            totalTokens: usage.totalTokenCount ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          }
          calculateCost(model, output.usage)
        }
      }
      for await (const text of readSse(response.body, options.signal)) consume(JSON.parse(text) as ResponseChunk)
      closeCurrent()
      if (output.content.length === 0) throw new Error('Antigravity returned an empty response')
      const reason = output.stopReason === 'toolUse' || output.stopReason === 'length' ? output.stopReason : 'stop'
      stream.push({ type: 'done', reason, message: output })
      if (requestAccountId) provider.reportSuccess(requestAccountId)
      stream.end()
    } catch (error) {
      if (requestAccountId && !options.signal?.aborted) provider.reportError?.(requestAccountId)
      output.stopReason = options.signal?.aborted ? 'aborted' : 'error'
      output.errorMessage = error instanceof Error ? error.message : String(error)
      stream.push({ type: 'error', reason: output.stopReason, error: output })
      stream.end()
    }
  })()
  return stream
}

/** Build the provider stream pair, closing over the rotation-aware auth source. */
export function createAntiGravityApi(provider: AuthProvider): ProviderStreams {
  const stream = (model: Model<Api>, context: PiContext, options?: StreamOptions) =>
    streamAntiGravity(model as Model<AntiGravityApi>, context, options ?? {}, provider)
  const streamSimple = (model: Model<Api>, context: PiContext, options?: SimpleStreamOptions) =>
    streamAntiGravity(model as Model<AntiGravityApi>, context, (options ?? {}) as StreamOptions, provider)
  return { stream, streamSimple }
}
