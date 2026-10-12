/** Wire model ids and reasoning configuration share one source of truth. */
export function resolveWireModel(id: string): { id: string; thinking?: Record<string, unknown> } {
  const variant = /^(gemini-.*)-(low|medium|high)$/.exec(id)
  if (variant) {
    const base = variant[1]!
    const level = variant[2]!
    // Antigravity advertises these as distinct backend routes, unlike Google's
    // public Gemini API. Keep discovery and inference on the same route.
    const wireId = base === 'gemini-3.5-flash'
      ? level === 'low' ? 'gemini-3.5-flash-low' : 'gemini-3-flash-agent'
      : /^gemini-3\.[678]-flash$/.test(base) || /^gemini-3(?:\.\d+)?-pro$/.test(base) ? id : base
    return { id: wireId, thinking: { includeThoughts: true, thinkingLevel: level } }
  }
  if (id.includes('claude-') && id.includes('thinking')) return { id, thinking: { includeThoughts: true, thinkingBudget: 32_768 } }
  return { id }
}

const SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'nullable', 'anyOf', 'format', 'minimum', 'maximum', 'minItems', 'maxItems'])

/** Remove unsupported JSON Schema keywords without interpreting property names as keywords. */
export function cleanSchema(value: unknown, uppercase = false, root: unknown = value, path = '#', refs: string[] = [], allowNull = false): unknown {
  const child = (schema: unknown, location: string, unionBranch = false): unknown => cleanSchema(schema, uppercase, root, location, refs, unionBranch)
  const fail = (message: string): never => { throw new Error(`Unsupported tool schema at ${path}: ${message}`) }
  if (value === false) return fail('false schemas cannot be represented')
  if (value === true) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const source = value as Record<string, unknown>
  if ('$ref' in source) {
    const ref = source.$ref
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return fail('only local JSON Pointer references are supported')
    if (refs.includes(ref)) return fail('recursive references cannot be represented')
    let target: unknown = root
    for (const segment of ref.slice(2).split('/')) {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
      if (typeof target !== 'object' || target === null || !Object.hasOwn(target, key)) return fail('unresolved local reference')
      target = (target as Record<string, unknown>)[key]
    }
    const resolved = cleanSchema(target, uppercase, root, path, [...refs, ref], allowNull)
    const { $ref: _, ...siblings } = source
    if (Object.keys(siblings).some((key) => !['description', '$comment', 'title', '$defs', 'definitions', '$schema', '$id'].includes(key))) return fail('reference siblings with validation constraints cannot be represented')
    return { ...resolved as Record<string, unknown>, ...typeof siblings.description === 'string' ? { description: siblings.description } : {} }
  }
  for (const key of ['allOf', 'not', 'if', 'then', 'else', '$dynamicRef']) {
    if (key in source) return fail(`${key} cannot be represented safely`)
  }
  const result: Record<string, unknown> = {}
  if (Array.isArray(source.type) && ('anyOf' in source || 'oneOf' in source)) return fail('combined type unions and alternatives cannot be represented safely')
  for (const [key, item] of Object.entries(source)) {
    if (!SCHEMA_KEYS.has(key)) continue
    if (key === 'properties' && typeof item === 'object' && item !== null) {
      result[key] = Object.fromEntries(Object.entries(item).map(([name, schema]) => [name, child(schema, `${path}/properties/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`)]))
    } else if (key === 'items') {
      if (Array.isArray(item)) return fail('tuple items cannot be represented')
      result[key] = child(item, `${path}/items`)
    }
    else if (key === 'anyOf' && Array.isArray(item)) result[key] = item.map((schema, index) => child(schema, `${path}/anyOf/${index}`, true))
    else if (key === 'type' && typeof item === 'string') result[key] = uppercase ? item.toUpperCase() : item
    else if (key === 'type' && Array.isArray(item)) {
      if (!item.length || item.some((type) => typeof type !== 'string')) return fail('invalid type union')
      result.anyOf = item.map((type) => child({ type }, `${path}/type`, true))
    }
    else result[key] = item
  }
  // Protobuf Schema has anyOf, not oneOf. Preserve the alternatives while
  // relaxing exclusivity; the harness remains responsible for input validation.
  if (Array.isArray(source.oneOf)) {
    if (result.anyOf !== undefined) return fail('combined oneOf and anyOf cannot be represented safely')
    result.anyOf = source.oneOf.map((schema, index) => child(schema, `${path}/oneOf/${index}`, true))
  }
  if (Array.isArray(result.anyOf)) {
    const alternatives = result.anyOf as Record<string, unknown>[]
    if (!alternatives.length) return fail('empty union cannot be represented')
    const nonNull = alternatives.filter((schema) => typeof schema.type !== 'string' || schema.type.toLowerCase() !== 'null')
    if (nonNull.length !== alternatives.length) {
      if (!nonNull.length) return fail('null-only unions cannot be represented')
      result.nullable = true
      if (nonNull.length === 1) {
        delete result.anyOf
        Object.assign(result, nonNull[0])
      } else result.anyOf = nonNull
    }
  }
  if (typeof result.type === 'string' && result.type.toLowerCase() === 'null') {
    // Kept temporarily for the parent union to normalize into nullable.
    if (!allowNull) return fail('null-only schemas cannot be represented')
    return result
  }
  if ('const' in source) result.enum = [source.const]
  if (Array.isArray(result.required)) {
    const properties = result.properties as Record<string, unknown> | undefined
    const required = result.required.filter((name) => typeof name === 'string' && properties !== undefined && Object.hasOwn(properties, name))
    if (required.length) result.required = required
    else delete result.required
  }
  if (typeof result.type === 'string' && result.type.toLowerCase() === 'array' && result.items === undefined) {
    result.items = { type: uppercase ? 'STRING' : 'string' }
  }
  return result
}

/** Normalize converted history; never replay Claude thinking or cross-model signatures. */
export function cleanContents(value: unknown, claude: boolean): unknown {
  if (!Array.isArray(value)) return value
  const pending: Array<{ id?: string; name: string }> = []
  const contents: Array<{ role?: string; parts: Array<Record<string, unknown>> }> = []
  const interrupted = (): Array<Record<string, unknown>> => pending.splice(0).map((call) => ({
    functionResponse: { ...call.id === undefined ? {} : { id: call.id }, name: call.name, response: { error: 'Tool execution was interrupted before a result was recorded.' } },
  }))
  for (const content of value as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>) {
    if (content.role === 'model' && pending.length) contents.push({ role: 'user', parts: interrupted() })
    const parts = (content.parts ?? []).flatMap((original) => {
      const part = { ...original }
      if (claude && part.thought === true) return []
      if (claude) delete part.thoughtSignature
      const call = part.functionCall as { id?: string; name?: string } | undefined
      if (call?.name) {
        // pi-ai intentionally omits IDs for Gemini. Do not manufacture wire IDs
        // on that path; Claude requires them and retains ID-based matching.
        const id = call.id ?? (claude ? crypto.randomUUID() : undefined)
        pending.push({ id, name: call.name })
        part.functionCall = { ...call, ...id === undefined ? {} : { id } }
      }
      const response = part.functionResponse as { id?: string; name?: string } | undefined
      if (response) {
        let index = response.id ? pending.findIndex((call) => call.id === response.id) : -1
        if (index < 0 && response.name) index = pending.findIndex((call) => call.name === response.name)
        if (index < 0) return []
        const [call] = pending.splice(index, 1)
        part.functionResponse = { ...response, name: call!.name, ...call!.id === undefined ? {} : { id: call!.id } }
      }
      return [part]
    })
    if (content.role === 'user' && pending.length) parts.unshift(...interrupted())
    if (parts.length) contents.push({ ...content, parts })
  }
  if (pending.length) contents.push({ role: 'user', parts: interrupted() })
  return contents
}

/** Read error bodies before retrying so connections can be reused. */
export async function responseFailure(response: Response): Promise<{ message: string; rateLimited: boolean; delay?: number }> {
  const text = await response.text()
  let body: unknown
  try { body = JSON.parse(text) } catch { body = undefined }
  const serialized = JSON.stringify(body ?? text)
  const rateLimited = response.status === 429 || (response.status === 403 && /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|QUOTA_EXCEEDED/i.test(serialized))
  const retry = response.headers.get('retry-after')
  const retryMs = response.headers.get('retry-after-ms')
  let delay = retryMs !== null && Number.isFinite(Number(retryMs)) ? Number(retryMs) : retry === null ? undefined : /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())
  const duration = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(serialized)
  if (delay === undefined && duration) delay = Number(duration[1]) * 1000
  return { message: `HTTP ${response.status}: ${text.slice(0, 1000)}`, rateLimited, ...(delay !== undefined && Number.isFinite(delay) ? { delay } : {}) }
}

/** SSE framing handles split CRLF, multiline data, EOF and protocol termination. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  const abort = (): void => { void reader.cancel(signal?.reason).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (done && buffer && !buffer.endsWith('\n')) buffer += '\n'
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (!line) {
          const event = data.join('\n')
          data = []
          if (event === '[DONE]') return
          if (event) yield event
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (done) {
        const event = data.join('\n')
        if (event && event !== '[DONE]') yield event
        return
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    try { await reader.cancel() } finally { reader.releaseLock() }
  }
}
