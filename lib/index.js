// src/index.ts
import { createProvider, defaultProviderAuthContext, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";

// src/api.ts
import { calculateCost, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { convertMessages, isThinkingPart, mapStopReasonString, retainThoughtSignature } from "@earendil-works/pi-ai/api/google-shared";

// src/constants.ts
var _idParts = ["1071006060591", "tmhssin2h21lcre235vtolojh4g403ep", "apps", "googleusercontent", "com"];
var _secParts = ["GOCSPX", "K58FWR486LdLJ1mLB8sXC4z6qDAf"];
var ANTIGRAVITY_CLIENT_ID = `${_idParts[0]}-${_idParts[1]}.${_idParts[2]}.${_idParts[3]}.${_idParts[4]}`;
var ANTIGRAVITY_CLIENT_SECRET = `${_secParts[0]}-${_secParts[1]}`;
var ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];
var OAUTH_CALLBACK_PORT = 51121;
var OAUTH_CALLBACK_PATH = "/oauth-callback";
var REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
var ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
];
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
var ANTIGRAVITY_VERSION = "2.5.2";
var SEARCH_MODEL = "gemini-2.5-flash";
var SEARCH_TIMEOUT_MS = 6e4;
var SEARCH_SYSTEM_INSTRUCTION = `You are an expert web search assistant with access to Google Search and URL analysis tools.
Guidelines:
- Always provide accurate, well-sourced information
- Cite your sources when presenting facts
- If analyzing URLs, extract the most relevant information
- Be concise but comprehensive
- If information is uncertain or conflicting, acknowledge it`;
function antiGravityHeaders(access) {
  const platform = process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
  return {
    authorization: `Bearer ${access}`,
    "content-type": "application/json",
    "user-agent": `antigravity/${ANTIGRAVITY_VERSION} ${platform === "WINDOWS" ? "windows/amd64" : platform === "MACOS" ? "darwin/arm64" : "linux/amd64"}`,
    "client-metadata": JSON.stringify({ ideType: "ANTIGRAVITY", platform, pluginType: "GEMINI" }),
    "x-goog-api-client": "google-cloud-sdk vscode_cloudshelleditor/0.1"
  };
}

// src/transport-transform.ts
function resolveWireModel(id) {
  const variant = /^(gemini-.*)-(low|medium|high)$/.exec(id);
  if (variant) {
    const base = variant[1];
    const level = variant[2];
    const wireId = base === "gemini-3.5-flash" ? level === "low" ? "gemini-3.5-flash-low" : "gemini-3-flash-agent" : /^gemini-3\.[678]-flash$/.test(base) || /^gemini-3(?:\.\d+)?-pro$/.test(base) ? id : base;
    return { id: wireId, thinking: { includeThoughts: true, thinkingLevel: level } };
  }
  if (id.includes("claude-") && id.includes("thinking")) return { id, thinking: { includeThoughts: true, thinkingBudget: 32768 } };
  return { id };
}
var SCHEMA_KEYS = /* @__PURE__ */ new Set(["type", "description", "properties", "required", "items", "enum", "nullable", "anyOf", "format", "minimum", "maximum", "minItems", "maxItems"]);
function cleanSchema(value, uppercase = false, root = value, path = "#", refs = [], allowNull = false) {
  const child = (schema, location, unionBranch = false) => cleanSchema(schema, uppercase, root, location, refs, unionBranch);
  const fail = (message) => {
    throw new Error(`Unsupported tool schema at ${path}: ${message}`);
  };
  if (value === false) return fail("false schemas cannot be represented");
  if (value === true) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const source = value;
  if ("$ref" in source) {
    const ref = source.$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/")) return fail("only local JSON Pointer references are supported");
    if (refs.includes(ref)) return fail("recursive references cannot be represented");
    let target = root;
    for (const segment of ref.slice(2).split("/")) {
      const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (typeof target !== "object" || target === null || !Object.hasOwn(target, key)) return fail("unresolved local reference");
      target = target[key];
    }
    const resolved = cleanSchema(target, uppercase, root, path, [...refs, ref], allowNull);
    const { $ref: _, ...siblings } = source;
    if (Object.keys(siblings).some((key) => !["description", "$comment", "title", "$defs", "definitions", "$schema", "$id"].includes(key))) return fail("reference siblings with validation constraints cannot be represented");
    return { ...resolved, ...typeof siblings.description === "string" ? { description: siblings.description } : {} };
  }
  for (const key of ["allOf", "not", "if", "then", "else", "$dynamicRef"]) {
    if (key in source) return fail(`${key} cannot be represented safely`);
  }
  const result = {};
  if (Array.isArray(source.type) && ("anyOf" in source || "oneOf" in source)) return fail("combined type unions and alternatives cannot be represented safely");
  for (const [key, item] of Object.entries(source)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && typeof item === "object" && item !== null) {
      result[key] = Object.fromEntries(Object.entries(item).map(([name2, schema]) => [name2, child(schema, `${path}/properties/${name2.replace(/~/g, "~0").replace(/\//g, "~1")}`)]));
    } else if (key === "items") {
      if (Array.isArray(item)) return fail("tuple items cannot be represented");
      result[key] = child(item, `${path}/items`);
    } else if (key === "anyOf" && Array.isArray(item)) result[key] = item.map((schema, index) => child(schema, `${path}/anyOf/${index}`, true));
    else if (key === "type" && typeof item === "string") result[key] = uppercase ? item.toUpperCase() : item;
    else if (key === "type" && Array.isArray(item)) {
      if (!item.length || item.some((type) => typeof type !== "string")) return fail("invalid type union");
      result.anyOf = item.map((type) => child({ type }, `${path}/type`, true));
    } else result[key] = item;
  }
  if (Array.isArray(source.oneOf)) {
    if (result.anyOf !== void 0) return fail("combined oneOf and anyOf cannot be represented safely");
    result.anyOf = source.oneOf.map((schema, index) => child(schema, `${path}/oneOf/${index}`, true));
  }
  if (Array.isArray(result.anyOf)) {
    const alternatives = result.anyOf;
    if (!alternatives.length) return fail("empty union cannot be represented");
    const nonNull = alternatives.filter((schema) => typeof schema.type !== "string" || schema.type.toLowerCase() !== "null");
    if (nonNull.length !== alternatives.length) {
      if (!nonNull.length) return fail("null-only unions cannot be represented");
      result.nullable = true;
      if (nonNull.length === 1) {
        delete result.anyOf;
        Object.assign(result, nonNull[0]);
      } else result.anyOf = nonNull;
    }
  }
  if (typeof result.type === "string" && result.type.toLowerCase() === "null") {
    if (!allowNull) return fail("null-only schemas cannot be represented");
    return result;
  }
  if ("const" in source) result.enum = [source.const];
  if (Array.isArray(result.required)) {
    const properties = result.properties;
    const required = result.required.filter((name2) => typeof name2 === "string" && properties !== void 0 && Object.hasOwn(properties, name2));
    if (required.length) result.required = required;
    else delete result.required;
  }
  if (typeof result.type === "string" && result.type.toLowerCase() === "array" && result.items === void 0) {
    result.items = { type: uppercase ? "STRING" : "string" };
  }
  return result;
}
function cleanContents(value, claude) {
  if (!Array.isArray(value)) return value;
  const pending = [];
  const contents = [];
  const interrupted = () => pending.splice(0).map((call) => ({
    functionResponse: { ...call.id === void 0 ? {} : { id: call.id }, name: call.name, response: { error: "Tool execution was interrupted before a result was recorded." } }
  }));
  for (const content of value) {
    if (content.role === "model" && pending.length) contents.push({ role: "user", parts: interrupted() });
    const parts = (content.parts ?? []).flatMap((original) => {
      const part = { ...original };
      if (claude && part.thought === true) return [];
      if (claude) delete part.thoughtSignature;
      const call = part.functionCall;
      if (call?.name) {
        const id = call.id ?? (claude ? crypto.randomUUID() : void 0);
        pending.push({ id, name: call.name });
        part.functionCall = { ...call, ...id === void 0 ? {} : { id } };
      }
      const response = part.functionResponse;
      if (response) {
        let index = response.id ? pending.findIndex((call3) => call3.id === response.id) : -1;
        if (index < 0 && response.name) index = pending.findIndex((call3) => call3.name === response.name);
        if (index < 0) return [];
        const [call2] = pending.splice(index, 1);
        part.functionResponse = { ...response, name: call2.name, ...call2.id === void 0 ? {} : { id: call2.id } };
      }
      return [part];
    });
    if (content.role === "user" && pending.length) parts.unshift(...interrupted());
    if (parts.length) contents.push({ ...content, parts });
  }
  if (pending.length) contents.push({ role: "user", parts: interrupted() });
  return contents;
}
async function responseFailure(response) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = void 0;
  }
  const serialized = JSON.stringify(body ?? text);
  const rateLimited = response.status === 429 || response.status === 403 && /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|QUOTA_EXCEEDED/i.test(serialized);
  const retry = response.headers.get("retry-after");
  const retryMs = response.headers.get("retry-after-ms");
  let delay2 = retryMs !== null && Number.isFinite(Number(retryMs)) ? Number(retryMs) : retry === null ? void 0 : /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1e3 : Math.max(0, Date.parse(retry) - Date.now());
  const duration = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(serialized);
  if (delay2 === void 0 && duration) delay2 = Number(duration[1]) * 1e3;
  return { message: `HTTP ${response.status}: ${text.slice(0, 1e3)}`, rateLimited, ...delay2 !== void 0 && Number.isFinite(delay2) ? { delay: delay2 } : {} };
}
async function* readSse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => void 0);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer && !buffer.endsWith("\n")) buffer += "\n";
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) {
          const event = data.join("\n");
          data = [];
          if (event === "[DONE]") return;
          if (event) yield event;
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (done) {
        const event = data.join("\n");
        if (event && event !== "[DONE]") yield event;
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

// src/api.ts
function parseRequestAuth(value) {
  if (value === void 0) throw new Error("Antigravity requires OAuth authentication");
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Antigravity OAuth request credential is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || typeof parsed.token !== "string" || typeof parsed.projectId !== "string") {
    throw new Error("Antigravity OAuth request credential is incomplete");
  }
  const record = parsed;
  return { ...record, accountId: typeof record.accountId === "string" ? record.accountId : "" };
}
function buildEnvelope(model, context, options, projectId) {
  const googleModel = model;
  const history = {
    ...context,
    messages: context.messages.map((message) => message.role === "assistant" ? { ...message, content: message.content.filter((part) => part.type !== "thinking" || !model.id.startsWith("claude-") && message.model === model.id && message.provider === model.provider) } : message)
  };
  const request = {
    contents: cleanContents(convertMessages(googleModel, history), model.id.startsWith("claude-")),
    ...options.sessionId === void 0 ? {} : { sessionId: options.sessionId }
  };
  if (context.systemPrompt !== void 0) {
    request.systemInstruction = { role: "user", parts: [{ text: context.systemPrompt }] };
  }
  const generationConfig = {};
  const wire = resolveWireModel(model.id);
  if (wire.thinking) generationConfig.thinkingConfig = wire.thinking;
  const reasoning = options.reasoning;
  if (model.id.includes("claude-") && model.id.includes("thinking") && reasoning !== void 0) {
    const budgets = { off: 0, minimal: 1024, low: 8192, medium: 16384, high: 32768, xhigh: 32768, max: 32768 };
    const custom = options.thinkingBudgets;
    const budget = custom?.[reasoning] ?? budgets[reasoning] ?? 16384;
    generationConfig.thinkingConfig = { includeThoughts: budget > 0, thinkingBudget: Math.min(budget, Math.max(0, (options.maxTokens ?? model.maxTokens) - 1)) };
  }
  if (options.temperature !== void 0) generationConfig.temperature = options.temperature;
  if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = options.maxTokens;
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
  if (context.tools !== void 0 && context.tools.length > 0) {
    request.tools = [{ functionDeclarations: context.tools.map((tool) => {
      try {
        return { name: tool.name, description: tool.description, parameters: normalizeToolSchema(tool.parameters, model.id.startsWith("claude-")) };
      } catch (error) {
        throw new Error(`Tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }) }];
  }
  return {
    project: projectId,
    model: wire.id,
    request,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent-${crypto.randomUUID()}`
  };
}
function normalizeToolSchema(value, claude) {
  const cleaned = cleanSchema(value, !claude);
  const schema = typeof cleaned === "object" && cleaned !== null && !Array.isArray(cleaned) ? { ...cleaned, type: claude ? "object" : "OBJECT" } : { type: claude ? "object" : "OBJECT" };
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null || !Object.keys(properties).length) {
    if (claude) {
      return { ...schema, properties: { _placeholder: { type: "boolean", description: "Placeholder. Always pass true." } }, required: ["_placeholder"] };
    }
    return { ...schema, properties: {} };
  }
  return schema;
}
async function openResponse(model, context, options, auth, provider) {
  let current = auth;
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted();
    let payload;
    try {
      payload = buildEnvelope(model, context, options, current.projectId);
    } catch (error) {
      provider.reportDiagnostic?.({ model: model.id, kind: "request-conversion-error", toolCount: context.tools?.length ?? 0 });
      throw error;
    }
    const replacement = await options.onPayload?.(payload, model);
    if (replacement != null) payload = replacement;
    const body = JSON.stringify(payload);
    let failure;
    for (const endpoint of ENDPOINTS) {
      const headers = {
        ...Object.fromEntries(Object.entries(options.headers ?? {}).filter((e) => e[1] !== null)),
        ...antiGravityHeaders(current.token),
        .../^gemini-3\.[78]-flash/.test(model.id) ? { "User-Agent": "antigravity/cli/1.2.7 (aidev_client; os_type=linux; arch=amd64; cl=962369648; auth_method=consumer)" } : {},
        accept: "text/event-stream",
        ...model.id.startsWith("claude-") ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}
      };
      let response;
      try {
        response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers,
          body,
          ...options.signal === void 0 ? {} : { signal: options.signal }
        });
      } catch (error) {
        options.signal?.throwIfAborted();
        failure = { message: error instanceof Error ? error.message : String(error), rateLimited: false };
        continue;
      }
      const headerRecord = Object.fromEntries(response.headers);
      try {
        await options.onResponse?.({ status: response.status, headers: headerRecord }, model);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      if (response.ok) {
        return { response, auth: current };
      }
      failure = await responseFailure(response);
      if (failure.rateLimited || ![404, 500, 502, 503, 504].includes(response.status)) break;
    }
    if (current.accountId && failure?.rateLimited) {
      provider.reportRateLimit(current.accountId, failure.delay);
      const next = await provider.afterRateLimit(current.accountId);
      if (next) {
        current = next;
        continue;
      }
    }
    throw new Error(`Antigravity inference failed with ${failure?.message ?? "unknown error"}`);
  }
  throw new Error("Antigravity inference failed after exhausting retries");
}
function streamAntiGravity(model, context, options, provider) {
  const stream = createAssistantMessageEventStream();
  const output2 = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now()
  };
  void (async () => {
    let requestAccountId = "";
    try {
      const auth = parseRequestAuth(options.apiKey);
      requestAccountId = auth.accountId;
      const opened = await openResponse(model, context, options, auth, provider);
      requestAccountId = opened.auth.accountId;
      const response = opened.response;
      if (response.body === null) throw new Error("Antigravity returned no response stream");
      let started = false;
      let finishReason;
      let current;
      const ensureStarted = () => {
        if (started) return;
        started = true;
        stream.push({ type: "start", partial: output2 });
      };
      const closeCurrent = () => {
        if (current === void 0) return;
        const index = output2.content.length - 1;
        if (current.type === "text") stream.push({ type: "text_end", contentIndex: index, content: current.text, partial: output2 });
        else stream.push({ type: "thinking_end", contentIndex: index, content: current.thinking, partial: output2 });
        current = void 0;
      };
      const consume = (chunk) => {
        if (chunk.error) throw new Error(chunk.error.message ?? chunk.error.status ?? "Antigravity stream error");
        const data = chunk.response;
        if (data === void 0) return;
        if (output2.responseId === void 0 && data.responseId !== void 0) output2.responseId = data.responseId;
        const candidate = data.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.text === void 0 && part.thoughtSignature !== void 0 && current?.type === "thinking") {
            current.thinkingSignature = part.thoughtSignature;
          }
          if (part.text === void 0 && part.thoughtSignature !== void 0 && current?.type === "text") {
            current.textSignature = part.thoughtSignature;
          }
          if (part.text !== void 0) {
            const thinking = isThinkingPart(part);
            let active = current;
            if (current === void 0 || thinking && current.type !== "thinking" || !thinking && current.type !== "text") {
              closeCurrent();
              const created = thinking ? { type: "thinking", thinking: "", ...part.thoughtSignature === void 0 ? {} : { thinkingSignature: part.thoughtSignature } } : { type: "text", text: "" };
              current = created;
              active = created;
              output2.content.push(created);
              ensureStarted();
              const index2 = output2.content.length - 1;
              stream.push(thinking ? { type: "thinking_start", contentIndex: index2, partial: output2 } : { type: "text_start", contentIndex: index2, partial: output2 });
            }
            const index = output2.content.length - 1;
            if (active === void 0) throw new Error("Antigravity stream block was not initialized");
            if (active.type === "thinking") {
              active.thinking += part.text;
              const signature = retainThoughtSignature(active.thinkingSignature, part.thoughtSignature);
              if (signature !== void 0) active.thinkingSignature = signature;
              stream.push({ type: "thinking_delta", contentIndex: index, delta: part.text, partial: output2 });
            } else {
              active.text += part.text;
              const signature = retainThoughtSignature(active.textSignature, part.thoughtSignature);
              if (signature !== void 0) active.textSignature = signature;
              stream.push({ type: "text_delta", contentIndex: index, delta: part.text, partial: output2 });
            }
          }
          if (part.functionCall !== void 0) {
            closeCurrent();
            const toolCall = {
              type: "toolCall",
              id: part.functionCall.id ?? `${part.functionCall.name ?? "tool"}_${crypto.randomUUID()}`,
              name: part.functionCall.name ?? "",
              arguments: part.functionCall.args ?? {},
              ...part.thoughtSignature === void 0 ? {} : { thoughtSignature: part.thoughtSignature }
            };
            output2.content.push(toolCall);
            ensureStarted();
            const index = output2.content.length - 1;
            stream.push({ type: "toolcall_start", contentIndex: index, partial: output2 });
            stream.push({ type: "toolcall_delta", contentIndex: index, delta: JSON.stringify(toolCall.arguments), partial: output2 });
            stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output2 });
          }
        }
        const usage = data.usageMetadata;
        if (usage !== void 0) {
          const cacheRead = usage.cachedContentTokenCount ?? 0;
          output2.usage = {
            input: Math.max(0, (usage.promptTokenCount ?? 0) - cacheRead),
            output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            reasoning: usage.thoughtsTokenCount ?? 0,
            cacheRead,
            cacheWrite: 0,
            totalTokens: usage.totalTokenCount ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          };
          calculateCost(model, output2.usage);
        }
        if (candidate?.finishReason !== void 0) {
          finishReason = candidate.finishReason;
          output2.stopReason = mapStopReasonString(candidate.finishReason);
          if (output2.stopReason === "error") {
            provider.reportDiagnostic?.({ model: model.id, finishReason, kind: "generation-finish-error", toolCount: context.tools?.length ?? 0 });
            const detail = candidate.finishMessage?.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 1e3);
            throw new Error(`Antigravity generation failed: ${finishReason}${detail ? ` (${detail})` : ""}`);
          }
        }
        if (output2.content.some((block) => block.type === "toolCall")) output2.stopReason = "toolUse";
      };
      for await (const text of readSse(response.body, options.signal)) consume(JSON.parse(text));
      closeCurrent();
      if (output2.content.length === 0 || output2.content.every((block) => block.type === "text" && !block.text.trim())) {
        provider.reportDiagnostic?.({ model: model.id, finishReason, kind: "empty-response" });
        throw new Error(`Antigravity returned an empty response (finishReason: ${finishReason ?? "missing"})`);
      }
      const reason = output2.stopReason === "toolUse" || output2.stopReason === "length" ? output2.stopReason : "stop";
      stream.push({ type: "done", reason, message: output2 });
      if (requestAccountId) provider.reportSuccess(requestAccountId);
      stream.end();
    } catch (error) {
      if (requestAccountId && !options.signal?.aborted) provider.reportError?.(requestAccountId);
      output2.stopReason = options.signal?.aborted ? "aborted" : "error";
      output2.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output2.stopReason, error: output2 });
      stream.end();
    }
  })();
  return stream;
}
function createAntiGravityApi(provider) {
  const stream = (model, context, options) => streamAntiGravity(model, context, options ?? {}, provider);
  const streamSimple = (model, context, options) => streamAntiGravity(model, context, options ?? {}, provider);
  return { stream, streamSimple };
}

// src/auth.ts
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
function base64Url(input) {
  return input.toString("base64url");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function discoverProject(access, signal) {
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: antiGravityHeaders(access),
        body: JSON.stringify({
          metadata: { ideName: "antigravity", ideType: "ANTIGRAVITY", ideVersion: "2.5.2" }
        }),
        ...signal === void 0 ? {} : { signal }
      });
      if (!response.ok) continue;
      const body = await response.json();
      const project = body.cloudaicompanionProject;
      if (typeof project === "string" && project.length > 0) return project;
      if (isRecord(project) && typeof project.id === "string" && project.id.length > 0) return project.id;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  throw new Error("Antigravity OAuth succeeded, but Cloud Code Assist returned no companion project");
}
async function exchange(params, signal) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) {
    throw new Error(`Antigravity token exchange failed with HTTP ${response.status}`);
  }
  const tokens = await response.json();
  if (!tokens || typeof tokens.access_token !== "string" || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || tokens.refresh_token !== void 0 && (typeof tokens.refresh_token !== "string" || !tokens.refresh_token)) {
    throw new Error("Invalid Antigravity OAuth token response");
  }
  return tokens;
}
async function fetchEmail(access, signal) {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${access}` },
      ...signal === void 0 ? {} : { signal }
    });
    if (!response.ok) return void 0;
    const body = await response.json();
    return typeof body.email === "string" ? body.email : void 0;
  } catch {
    return void 0;
  }
}
async function login(interaction, clientConfig) {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(24));
  const auth = new URL(AUTHORIZE_URL);
  auth.search = new URLSearchParams({
    client_id: clientConfig.clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: ANTIGRAVITY_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent"
  }).toString();
  interaction.signal?.throwIfAborted();
  const code = await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      interaction.signal?.removeEventListener("abort", abort);
      server.close();
    };
    const abort = () => {
      cleanup();
      reject(new Error("Antigravity OAuth was cancelled"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Antigravity OAuth timed out"));
    }, 3e5);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== OAUTH_CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      const receivedCode = url.searchParams.get("code");
      if (url.searchParams.get("state") === state && url.searchParams.has("error")) {
        response.writeHead(400).end("Antigravity authorization was declined.");
        cleanup();
        reject(new Error("Antigravity authorization was declined"));
        return;
      }
      if (url.searchParams.get("state") !== state || !receivedCode) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Antigravity OAuth callback is invalid.");
        return;
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Antigravity login completed. You may close this page.");
      cleanup();
      resolve(receivedCode);
    });
    server.on("error", (error) => {
      cleanup();
      reject(new Error(`Could not start the Antigravity OAuth callback on port ${OAUTH_CALLBACK_PORT}: ${error.message}. Close other Antigravity sessions and retry.`));
    });
    server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      if (settled) {
        server.close();
        return;
      }
      try {
        interaction.notify({ type: "auth_url", url: auth.toString(), instructions: "Complete the Google Antigravity authorization in your browser." });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    interaction.signal?.addEventListener("abort", abort, { once: true });
    if (interaction.signal?.aborted) abort();
  });
  const tokens = await exchange(new URLSearchParams({
    client_id: clientConfig.clientId,
    client_secret: clientConfig.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  }), interaction.signal);
  if (tokens.refresh_token === void 0) {
    throw new Error("Antigravity OAuth returned no refresh token; revoke prior grants and retry.");
  }
  const projectId = await discoverProject(tokens.access_token, interaction.signal);
  const email = await fetchEmail(tokens.access_token, interaction.signal);
  const credential = {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + tokens.expires_in * 1e3 - 3e5,
    projectId,
    email
  };
  return credential;
}
var EXPIRY_MARGIN_MS = 3e5;
function createAntiGravityOAuth(resolveClientConfig) {
  return {
    name: "Google Antigravity",
    loginLabel: "Sign in with your Google account (Antigravity)",
    login: async (interaction) => login(interaction, await resolveClientConfig()),
    async refresh(credential, signal) {
      const current = credential;
      if (typeof current.projectId !== "string" || current.projectId.length === 0) {
        throw new Error("Antigravity credential has no Cloud Code Assist project id");
      }
      const clientConfig = await resolveClientConfig();
      const tokens = await exchange(new URLSearchParams({
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
        refresh_token: credential.refresh,
        grant_type: "refresh_token"
      }), signal);
      return {
        ...credential,
        access: tokens.access_token,
        refresh: tokens.refresh_token ?? credential.refresh,
        expires: Date.now() + tokens.expires_in * 1e3 - EXPIRY_MARGIN_MS
      };
    },
    toAuth: (credential) => {
      const current = credential;
      if (typeof current.projectId !== "string" || current.projectId.length === 0) {
        throw new Error("Antigravity credential has no Cloud Code Assist project id");
      }
      return Promise.resolve({ apiKey: JSON.stringify({ token: credential.access, projectId: current.projectId }) });
    }
  };
}

// src/client-config.ts
var DEFAULT_OAUTH_CLIENT_CONFIG_REF = "GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG";
var CLIENT_ID_PATTERN = /^[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
var CLIENT_SECRET_PATTERN = /^GOCSPX-[A-Za-z0-9_-]+$/;
var CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function embeddedClientConfig() {
  return { clientId: ANTIGRAVITY_CLIENT_ID, clientSecret: ANTIGRAVITY_CLIENT_SECRET };
}
function parseOAuthClientConfig(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Antigravity OAuth client configuration is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Antigravity OAuth client configuration must be a JSON object");
  }
  const { clientId, clientSecret } = parsed;
  if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error("Antigravity OAuth client configuration has an invalid clientId");
  }
  if (typeof clientSecret !== "string" || !CLIENT_SECRET_PATTERN.test(clientSecret)) {
    throw new Error("Antigravity OAuth client configuration has an invalid clientSecret");
  }
  return { clientId, clientSecret };
}
async function resolveOAuthClientConfig(credentials, refValue = DEFAULT_OAUTH_CLIENT_CONFIG_REF) {
  if (!CREDENTIAL_REF_PATTERN.test(refValue)) {
    throw new Error("Antigravity OAuth client credential reference must be a POSIX identifier");
  }
  const existing = await credentials.resolve(refValue);
  if (existing !== void 0) return parseOAuthClientConfig(existing.value);
  return embeddedClientConfig();
}

// src/manager.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// src/token.ts
var EXPIRY_MARGIN_MS2 = 3e5;
function parseOAuthError(text) {
  if (!text) return {};
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object") return { description: text };
    let code;
    if (typeof payload.error === "string") {
      code = payload.error;
    } else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status ?? payload.error.code;
      if (!payload.error_description && payload.error.message) return { code, description: payload.error.message };
    }
    const description = payload.error_description;
    if (description) return { code, description };
    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return { code, description: payload.error.message };
    }
    return { code };
  } catch {
    return { description: text };
  }
}
async function refreshAccountAccess(refreshToken, clientConfig, signal) {
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      signal,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret
      })
    });
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => void 0);
    const { code, description } = parseOAuthError(text);
    if (code === "invalid_grant") {
      return { kind: "revoked" };
    }
    return { kind: "error", message: description ?? text ?? `HTTP ${response.status}`, status: response.status };
  }
  let payload;
  try {
    payload = await response.json();
    if (!payload || typeof payload.access_token !== "string" || !payload.access_token || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0 || payload.refresh_token !== void 0 && (typeof payload.refresh_token !== "string" || !payload.refresh_token)) {
      return { kind: "error", message: "Invalid OAuth token response" };
    }
  } catch {
    return { kind: "error", message: "Invalid OAuth token response" };
  }
  return {
    kind: "ok",
    access: payload.access_token,
    expires: Date.now() + payload.expires_in * 1e3 - EXPIRY_MARGIN_MS2,
    ...payload.refresh_token === void 0 ? {} : { refreshToken: payload.refresh_token }
  };
}

// src/rotation.ts
var DEFAULT_HEALTH = {
  initial: 70,
  successReward: 1,
  rateLimitPenalty: -10,
  failurePenalty: -20,
  recoveryPerHour: 2,
  minUsable: 50,
  max: 100
};
var HealthTracker = class {
  constructor(config = DEFAULT_HEALTH) {
    this.config = config;
  }
  config;
  states = /* @__PURE__ */ new Map();
  get(id, now = Date.now()) {
    const state = this.states.get(id);
    if (!state) return this.config.initial;
    const hours = Math.max(0, now - state.updatedAt) / 36e5;
    return Math.min(this.config.max, state.score + Math.floor(hours * this.config.recoveryPerHour));
  }
  success(id, now = Date.now()) {
    const score = Math.min(this.config.max, this.get(id, now) + this.config.successReward);
    this.states.set(id, { score, updatedAt: now, failures: 0 });
  }
  rateLimited(id, now = Date.now()) {
    const state = this.states.get(id);
    const score = Math.max(0, this.get(id, now) + this.config.rateLimitPenalty);
    this.states.set(id, { score, updatedAt: now, failures: (state?.failures ?? 0) + 1 });
  }
  failure(id, now = Date.now()) {
    const state = this.states.get(id);
    const score = Math.max(0, this.get(id, now) + this.config.failurePenalty);
    this.states.set(id, { score, updatedAt: now, failures: (state?.failures ?? 0) + 1 });
  }
  isUsable(id, now = Date.now()) {
    return this.get(id, now) >= this.config.minUsable;
  }
  /** Forget failures after a fresh authorization. */
  reset(id) {
    this.states.delete(id);
  }
};
var TokenBucket = class {
  constructor(max = 50, regenPerMinute = 6) {
    this.max = max;
    this.regenPerMinute = regenPerMinute;
  }
  max;
  regenPerMinute;
  buckets = /* @__PURE__ */ new Map();
  /** Current token balance for an account, applying regeneration. */
  balance(id, now = Date.now()) {
    const state = this.buckets.get(id);
    if (!state) return this.max;
    const minutes = Math.max(0, now - state.updatedAt) / 6e4;
    return Math.min(this.max, state.tokens + minutes * this.regenPerMinute);
  }
  has(id, cost = 1, now = Date.now()) {
    return this.balance(id, now) >= cost;
  }
  consume(id, cost = 1, now = Date.now()) {
    const tokens = this.balance(id, now);
    if (tokens < cost) return false;
    this.buckets.set(id, { tokens: tokens - cost, updatedAt: now });
    return true;
  }
  refund(id, amount = 1, now = Date.now()) {
    this.buckets.set(id, { tokens: Math.min(this.max, this.balance(id, now) + amount), updatedAt: now });
  }
};
function isRateLimited(account, now = Date.now()) {
  const until = account.rateLimitedUntil;
  if (!until) return false;
  return Object.values(until).some((t) => t > now);
}
function isCoolingDown(account, now = Date.now()) {
  return (account.coolingDownUntil ?? 0) > now;
}
var STICKINESS = 150;
var SWITCH_THRESHOLD = 100;
function selectAccount(input) {
  const now = input.now ?? Date.now();
  const candidates = input.accounts.filter(
    (a) => a.enabled && !isRateLimited(a, now) && !isCoolingDown(a, now) && input.health.isUsable(a.id, now) && input.bucket.has(a.id, 1, now)
  );
  if (candidates.length === 0) return void 0;
  const scored = candidates.map((account) => {
    const health = input.health.get(account.id, now);
    const tokens = input.bucket.balance(account.id, now);
    const restSeconds = Math.min((now - account.lastUsed) / 1e3, 3600);
    const base = health * 2 + tokens / 50 * 100 * 5 + restSeconds * 0.1;
    const stick = account.id === input.activeId ? STICKINESS : 0;
    return { id: account.id, base, score: base + stick, isCurrent: account.id === input.activeId };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return void 0;
  const current = scored.find((s) => s.isCurrent);
  if (current && !best.isCurrent && best.base - current.base < SWITCH_THRESHOLD) {
    return current.id;
  }
  return best.id;
}

// src/storage.ts
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
function stateDir() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "dsh-agy");
}
function poolPath() {
  return join(stateDir(), "accounts.json");
}
function emptyStorage() {
  return { version: 1, accounts: [] };
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function sanitizeFingerprint(value) {
  if (!isRecord2(value)) return void 0;
  const deviceId = str(value.deviceId);
  const userAgent = str(value.userAgent);
  if (deviceId === void 0 || userAgent === void 0) return void 0;
  return { deviceId, userAgent };
}
function sanitizeRateLimits(value) {
  if (!isRecord2(value)) return void 0;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const t = num(entry);
    if (t !== void 0) out[key] = t;
  }
  return Object.keys(out).length > 0 ? out : void 0;
}
function sanitizeAccount(value) {
  if (!isRecord2(value)) return void 0;
  const id = str(value.id);
  const refreshToken = str(value.refreshToken);
  const projectId = str(value.projectId);
  if (id === void 0 || refreshToken === void 0 || projectId === void 0) return void 0;
  const fingerprint = sanitizeFingerprint(value.fingerprint);
  const rateLimitedUntil = sanitizeRateLimits(value.rateLimitedUntil);
  return {
    id,
    ...str(value.email) === void 0 ? {} : { email: str(value.email) },
    refreshToken,
    projectId,
    addedAt: num(value.addedAt) ?? 0,
    lastUsed: num(value.lastUsed) ?? 0,
    ...str(value.accessToken) === void 0 ? {} : { accessToken: str(value.accessToken) },
    ...num(value.accessExpires) === void 0 ? {} : { accessExpires: num(value.accessExpires) },
    ...fingerprint === void 0 ? {} : { fingerprint },
    ...rateLimitedUntil === void 0 ? {} : { rateLimitedUntil },
    ...num(value.coolingDownUntil) === void 0 ? {} : { coolingDownUntil: num(value.coolingDownUntil) },
    enabled: value.enabled !== false
  };
}
var writeChain = Promise.resolve();
function withLock(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => void 0);
  return run;
}
async function loadPool() {
  try {
    const content = await fs.readFile(poolPath(), "utf8");
    const parsed = JSON.parse(content);
    if (!isRecord2(parsed) || parsed.version !== 1 || !Array.isArray(parsed.accounts)) return emptyStorage();
    const accounts = parsed.accounts.map(sanitizeAccount).filter((a) => a !== void 0);
    const activeId = typeof parsed.activeId === "string" && accounts.some((a) => a.id === parsed.activeId) ? parsed.activeId : accounts[0]?.id;
    return { version: 1, accounts, ...activeId === void 0 ? {} : { activeId } };
  } catch {
    return emptyStorage();
  }
}
function savePool(storage) {
  const content = JSON.stringify(storage, null, 2);
  const target = poolPath();
  const dir = stateDir();
  return withLock(async () => {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, content, { encoding: "utf8", mode: 384, flag: "wx" });
      await fs.rename(tmp, target);
    } finally {
      await fs.unlink(tmp).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  });
}
async function clearPool() {
  const target = poolPath();
  await withLock(async () => {
    try {
      await fs.unlink(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  });
}

// src/manager.ts
var RATE_LIMIT_WINDOW_MS = 30 * 6e4;
var COOLDOWN_MS = 6e4;
var AccountManager = class {
  constructor(options) {
    this.options = options;
  }
  options;
  accounts = [];
  activeId;
  loaded = false;
  initialization;
  disposed = false;
  lifetime = new AbortController();
  refreshes = /* @__PURE__ */ new Map();
  health = new HealthTracker();
  bucket = new TokenBucket();
  attempt;
  /** Load the pool from disk (idempotent). */
  async init() {
    if (this.disposed) throw new Error("Antigravity manager was disposed");
    if (this.loaded) return;
    this.initialization ??= loadPool().then((pool) => {
      this.accounts = pool.accounts;
      this.activeId = pool.activeId;
      this.loaded = true;
    }).catch((error) => {
      this.initialization = void 0;
      throw error;
    });
    await this.initialization;
    if (this.disposed) throw new Error("Antigravity manager was disposed");
  }
  async clientConfig() {
    return resolveOAuthClientConfig(this.options.credentials, this.options.clientConfigRef ?? DEFAULT_OAUTH_CLIENT_CONFIG_REF);
  }
  async persist() {
    await savePool({
      version: 1,
      accounts: this.accounts,
      ...this.activeId === void 0 ? {} : { activeId: this.activeId }
    });
  }
  /** Read-only account views for display. */
  async list() {
    await this.init();
    const now = Date.now();
    return this.accounts.map((a) => ({
      id: a.id,
      email: a.email,
      enabled: a.enabled,
      active: a.id === this.activeId,
      rateLimited: isRateLimited(a, now),
      coolingDown: isCoolingDown(a, now)
    }));
  }
  /** Whether any account is configured. */
  async hasAccounts() {
    await this.init();
    return this.accounts.length > 0;
  }
  /** Ambient access for every account (refreshing as needed), for quota display. */
  async quotaAccounts() {
    await this.init();
    const out = [];
    for (const account of this.accounts) {
      if (!account.enabled) {
        out.push({ id: account.id, email: account.email, enabled: false, projectId: account.projectId, access: "" });
        continue;
      }
      try {
        out.push({ id: account.id, email: account.email, enabled: true, projectId: account.projectId, access: await this.ensureAccess(account) });
      } catch {
        out.push({ id: account.id, email: account.email, enabled: account.enabled, projectId: account.projectId, access: "" });
      }
    }
    return out;
  }
  // ---- Login / logout -----------------------------------------------------
  /** Start one OAuth login; the browser opens `authorizationUrl`. */
  async startLogin() {
    await this.init();
    this.cancelLogin();
    const attempt = { id: randomUUID2(), controller: new AbortController(), status: { kind: "pending" } };
    this.attempt = attempt;
    let resolveUrl;
    let rejectUrl;
    const promise = new Promise((resolve, reject) => {
      resolveUrl = resolve;
      rejectUrl = reject;
    });
    const url = { resolve: resolveUrl, reject: rejectUrl, promise };
    attempt.controller.signal.addEventListener("abort", () => url.reject(new Error("Antigravity OAuth was cancelled")), { once: true });
    const notify = (event) => {
      if (event.type === "auth_url" && typeof event.url === "string") url.resolve(event.url);
    };
    const piInteraction = {
      signal: attempt.controller.signal,
      notify,
      prompt: () => Promise.reject(new Error("Antigravity OAuth does not support interactive prompts"))
    };
    void this.options.oauth.login(piInteraction).then(async (credential) => {
      url.reject(new Error("Antigravity OAuth completed without an authorization URL"));
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return;
      await this.addCredential(credential);
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return;
      attempt.status = { kind: "succeeded", email: credential.email };
    }).catch((error) => {
      if (attempt.controller.signal.aborted) {
        attempt.status = { kind: "cancelled" };
        url.reject(new Error("Antigravity OAuth was cancelled"));
        return;
      }
      const message = error instanceof Error ? error.message : "Antigravity OAuth failed";
      attempt.status = { kind: "failed", message };
      url.reject(new Error(message));
    });
    return { loginId: attempt.id, authorizationUrl: await url.promise };
  }
  /** Poll one login attempt's status. */
  pollLogin(id) {
    if (this.attempt?.id !== id) return { kind: "failed", message: "Antigravity login attempt is no longer active" };
    return this.attempt.status;
  }
  /** Cancel the current login (or only the supplied matching attempt). */
  cancelLogin(id) {
    if (!this.attempt || id !== void 0 && this.attempt.id !== id) return;
    if (this.attempt.status.kind !== "pending") return;
    this.attempt.status = { kind: "cancelled" };
    this.attempt.controller.abort();
  }
  /** Stop login and in-flight token refreshes; the manager cannot be reused. */
  dispose() {
    this.cancelLogin();
    this.disposed = true;
    this.lifetime.abort();
  }
  /** Remove one account, or all when `accountId` is undefined. */
  async remove(accountId) {
    await this.init();
    if (accountId === void 0) {
      this.cancelLogin();
      this.accounts = [];
      this.activeId = void 0;
      await clearPool();
      await this.options.credentials.unset(this.options.credentialRef);
      return;
    }
    this.accounts = this.accounts.filter((a) => a.id !== accountId);
    if (this.activeId === accountId) this.activeId = this.accounts[0]?.id;
    await this.persist();
    if (this.accounts.length === 0) await this.options.credentials.unset(this.options.credentialRef);
    else await this.mirrorActive();
  }
  /** Explicitly select the active account. */
  async setActive(accountId) {
    await this.init();
    const account = this.accounts.find((a) => a.id === accountId);
    if (!account || !account.enabled || isRateLimited(account) || isCoolingDown(account)) return false;
    this.activeId = accountId;
    await this.persist();
    await this.mirrorActive();
    return true;
  }
  // ---- Auth resolution ----------------------------------------------------
  /** Pick the best account, refresh its access token, and return request auth. */
  async resolveAuth(excludeIds) {
    await this.init();
    const now = Date.now();
    const pool = excludeIds ? this.accounts.filter((a) => !excludeIds.has(a.id)) : this.accounts;
    if (pool.length === 0) throw new Error("No Antigravity accounts configured. Open Settings \u2192 Antigravity and sign in.");
    let chosenId = selectAccount({ accounts: pool, activeId: this.activeId, health: this.health, bucket: this.bucket, now });
    if (chosenId === void 0) {
      const waits = pool.filter((a) => a.enabled && this.health.isUsable(a.id, now) && this.bucket.has(a.id, 1, now)).map((a) => Math.max(a.coolingDownUntil ?? 0, ...Object.values(a.rateLimitedUntil ?? {})) - now).filter((wait2) => wait2 > 0);
      const wait = Math.min(...waits);
      const configuredWait = this.options.maxWaitMs ?? 1e3;
      const bound = Number.isFinite(configuredWait) ? Math.max(0, Math.min(configuredWait, 5e3)) : 1e3;
      if (wait <= bound) {
        await delay(wait, void 0, { signal: this.lifetime.signal });
        chosenId = selectAccount({ accounts: pool.filter((a) => this.accounts.includes(a)), activeId: this.activeId, health: this.health, bucket: this.bucket });
      }
    }
    if (chosenId === void 0) throw new Error("No usable Antigravity account is available right now.");
    const account = this.accounts.find((a) => a.id === chosenId);
    if (!account) throw new Error("Antigravity account selection failed.");
    const access = await this.ensureAccess(account);
    if (!account.enabled || !this.accounts.includes(account) || isRateLimited(account) || isCoolingDown(account) || this.disposed) {
      throw new Error("Antigravity account is no longer available");
    }
    account.lastUsed = Date.now();
    if (!this.bucket.consume(account.id)) throw new Error("Antigravity account request budget was exhausted");
    await this.persist();
    return { token: access, projectId: account.projectId, accountId: account.id };
  }
  /** Ensure the account has a valid access token, refreshing when expired. */
  async ensureAccess(account) {
    if (this.disposed || !account.enabled || !this.accounts.includes(account)) throw new Error("Antigravity account is unavailable");
    if (account.accessToken && (account.accessExpires ?? 0) > Date.now() + 3e4) {
      return account.accessToken;
    }
    const pending = this.refreshes.get(account.id);
    if (pending) return pending;
    const operation = this.refreshAccess(account).finally(() => {
      this.refreshes.delete(account.id);
    });
    this.refreshes.set(account.id, operation);
    return operation;
  }
  async refreshAccess(account) {
    const refreshToken = account.refreshToken;
    const previousAccess = account.accessToken;
    const config = await this.clientConfig();
    this.lifetime.signal.throwIfAborted();
    const result = await refreshAccountAccess(refreshToken, config, this.lifetime.signal);
    this.lifetime.signal.throwIfAborted();
    if (!this.accounts.includes(account) || account.refreshToken !== refreshToken || account.accessToken !== previousAccess) throw new Error("Antigravity account changed during refresh");
    if (result.kind === "revoked") {
      account.enabled = false;
      delete account.accessToken;
      delete account.accessExpires;
      await this.persist();
      if (this.activeId === account.id) await this.options.credentials.unset(this.options.credentialRef);
      throw new Error(`Antigravity account ${account.email ?? account.id.slice(0, 8)} was revoked; sign in again.`);
    }
    if (result.kind === "error") {
      this.health.failure(account.id);
      account.coolingDownUntil = Date.now() + COOLDOWN_MS;
      await this.persist();
      throw new Error(`Antigravity token refresh failed: ${result.message}`);
    }
    account.accessToken = result.access;
    account.accessExpires = result.expires;
    if (result.refreshToken) account.refreshToken = result.refreshToken;
    await this.persist();
    return result.access;
  }
  // ---- AuthProvider (rotation hooks used by api.ts) ----------------------
  reportRateLimit(accountId, delayMs) {
    const account = this.accounts.find((a) => a.id === accountId);
    if (account) {
      const delay2 = delayMs !== void 0 && Number.isFinite(delayMs) && delayMs >= 0 ? Math.min(delayMs, 864e5) : RATE_LIMIT_WINDOW_MS;
      account.rateLimitedUntil = { ...account.rateLimitedUntil ?? {}, all: Math.max(account.rateLimitedUntil?.all ?? 0, Date.now() + delay2) };
      void this.persist().catch(() => {
      });
    }
    this.health.rateLimited(accountId);
  }
  reportSuccess(accountId) {
    this.health.success(accountId);
  }
  reportError(accountId) {
    this.health.failure(accountId);
  }
  reportDiagnostic;
  /** Get a distinct account's auth after `accountId` was rate-limited. */
  async afterRateLimit(accountId) {
    try {
      return await this.resolveAuth(/* @__PURE__ */ new Set([accountId]));
    } catch {
      return void 0;
    }
  }
  /** Resolve pi-ai request auth (single active account, rotation applied). */
  async resolveApiKey() {
    return JSON.stringify(await this.resolveAuth());
  }
  // ---- Internal helpers ---------------------------------------------------
  async addCredential(credential) {
    const current = credential;
    if (typeof current.projectId !== "string" || current.projectId.length === 0) {
      throw new Error("Antigravity login returned no Cloud Code Assist project id");
    }
    const existing = this.accounts.find((a) => a.refreshToken === credential.refresh || a.email && a.email === current.email);
    const now = Date.now();
    if (existing) {
      existing.refreshToken = credential.refresh;
      existing.projectId = current.projectId;
      existing.email = current.email ?? existing.email;
      existing.accessToken = credential.access;
      existing.accessExpires = credential.expires;
      existing.enabled = true;
      this.health.reset(existing.id);
      delete existing.rateLimitedUntil;
      delete existing.coolingDownUntil;
      this.activeId = existing.id;
    } else {
      const account = {
        id: randomUUID2(),
        email: current.email,
        refreshToken: credential.refresh,
        projectId: current.projectId,
        addedAt: now,
        lastUsed: now,
        accessToken: credential.access,
        accessExpires: credential.expires,
        enabled: true
      };
      this.accounts.push(account);
      this.activeId = account.id;
    }
    await this.persist();
    await this.mirrorActive();
  }
  /** Keep the Harness credential store in sync with the active account. */
  async mirrorActive() {
    const account = this.accounts.find((a) => a.id === this.activeId);
    if (!account || !account.enabled) {
      await this.options.credentials.unset(this.options.credentialRef);
      return;
    }
    const mirror = {
      type: "oauth",
      access: account.accessToken ?? "",
      refresh: account.refreshToken,
      expires: account.accessExpires ?? 0,
      projectId: account.projectId,
      ...account.email === void 0 ? {} : { email: account.email }
    };
    await this.options.credentials.set(this.options.credentialRef, JSON.stringify(mirror));
  }
};

// src/models.ts
var PROVIDER = "google-antigravity";
var NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
function descriptor(id, name2, family, level) {
  const contextWindow = family === "gemini" ? 1048576 : family === "claude" ? 2e5 : 131072;
  const output2 = family === "gpt" ? 8192 : family === "claude" ? 64e3 : 65536;
  return {
    id,
    name: name2,
    api: "google-antigravity",
    provider: PROVIDER,
    baseUrl: ENDPOINTS[0],
    reasoning: family !== "claude" || id.includes("thinking"),
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: level === "low" ? "low" : null,
      medium: level === "medium" ? "medium" : null,
      high: level === "high" ? "high" : null,
      xhigh: null,
      max: null
    },
    input: ["text", "image"],
    cost: NO_COST,
    contextWindow,
    maxTokens: output2
  };
}
function flashRange(version) {
  return ["low", "medium", "high"].map((level) => descriptor(`gemini-${version}-flash-${level}`, `Gemini ${version} Flash (${level})`, "gemini", level));
}
var maintainedModels = [
  ...flashRange("3.8"),
  ...flashRange("3.7"),
  ...flashRange("3.6"),
  ...flashRange("3.5"),
  descriptor("gemini-3.1-pro-high", "Gemini 3.1 Pro (High)", "gemini", "high"),
  descriptor("gemini-3.1-pro-low", "Gemini 3.1 Pro (Low)", "gemini", "low"),
  descriptor("claude-sonnet-4-6", "Claude Sonnet 4.6", "claude", "high"),
  {
    ...descriptor("claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)", "claude", "high"),
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }
  },
  descriptor("gpt-oss-120b-medium", "GPT-OSS 120B (Medium)", "gpt", "medium")
];
function parseAvailableModels(payload) {
  if (typeof payload !== "object" || payload === null || typeof payload.models !== "object" || payload.models === null || Array.isArray(payload.models)) {
    throw new Error("Antigravity model response must contain a models object");
  }
  const live = payload.models;
  return maintainedModels.flatMap((model) => {
    const entry = live[model.id] ?? live[resolveWireModel(model.id).id];
    if (typeof entry !== "object" || entry === null) return [];
    const name2 = typeof entry.displayName === "string" && entry.displayName.length > 0 ? entry.displayName : model.name;
    return [{ ...model, name: name2 }];
  });
}
async function fetchAvailableModels(access, projectId, signal) {
  let lastStatus;
  for (const endpoint of ENDPOINTS) {
    const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
      method: "POST",
      headers: antiGravityHeaders(access),
      body: JSON.stringify({ project: projectId }),
      ...signal === void 0 ? {} : { signal }
    });
    if (response.ok) {
      const models = parseAvailableModels(await response.json());
      if (models.length === 0) throw new Error("Antigravity returned no maintained models");
      return models;
    }
    lastStatus = response.status;
    await responseFailure(response);
    if (![404, 500, 502, 503, 504].includes(response.status)) break;
  }
  throw new Error(`Antigravity model discovery failed with HTTP ${lastStatus ?? "unknown"}`);
}

// src/quota.ts
var FETCH_TIMEOUT_MS = 15e3;
function normalizeFraction(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
function formatDuration(ms) {
  const seconds = Math.floor(Math.abs(ms) / 1e3);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor(seconds % 86400 / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
async function fetchSummary(access, projectId, signal) {
  let lastError = "";
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
        method: "POST",
        headers: antiGravityHeaders(access),
        body: JSON.stringify({ project: projectId }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (response.ok) return await response.json();
      lastError = (await responseFailure(response)).message;
      if (![404, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Antigravity quota summary failed (${lastError})`);
}
async function fetchAccountQuota(account, access, signal) {
  if (!account.enabled) return { accountId: account.id, email: account.email, status: "disabled", buckets: [] };
  try {
    let summary;
    try {
      summary = await fetchSummary(access, account.projectId, signal);
    } catch {
      signal?.throwIfAborted();
      const response = await fetch(`${ENDPOINTS[0]}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: antiGravityHeaders(access),
        body: JSON.stringify({ project: account.projectId }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error((await responseFailure(response)).message);
      const payload = await response.json();
      summary = { groups: Object.entries(payload.models ?? {}).flatMap(([id, model]) => model.quotaInfo ? [{ displayName: model.displayName ?? id, buckets: [{ ...model.quotaInfo, window: "model", bucketId: id }] }] : []) };
    }
    const now = Date.now();
    const buckets = [];
    for (const group of summary.groups ?? []) {
      for (const bucket of group.buckets ?? []) {
        const fraction = normalizeFraction(bucket.remainingFraction);
        let resetTime = new Date(now + 864e5);
        if (bucket.resetTime) {
          const parsed = new Date(bucket.resetTime);
          if (!Number.isNaN(parsed.getTime())) resetTime = parsed;
        }
        const timeUntilReset = Math.max(0, resetTime.getTime() - now);
        buckets.push({
          window: /weekly|week|7d/i.test(bucket.window || bucket.bucketId || "") ? "weekly" : /5h|five.?hour/i.test(bucket.window || bucket.bucketId || "") ? "5h" : bucket.window || bucket.bucketId || "unknown",
          label: [group.displayName, bucket.displayName || bucket.bucketId].filter(Boolean).join(" \u2014 ") || "Limit",
          remainingFraction: fraction,
          remainingPercentage: Math.round(fraction * 100),
          resetTime,
          timeUntilReset,
          timeUntilResetFormatted: formatDuration(timeUntilReset)
        });
      }
    }
    return { accountId: account.id, email: account.email, status: "ok", buckets };
  } catch (error) {
    signal?.throwIfAborted();
    return { accountId: account.id, email: account.email, status: "error", error: error instanceof Error ? error.message : String(error), buckets: [] };
  }
}
function bar(percent, width = 12) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round(clamped / 100 * width);
  return `${"\u2588".repeat(filled)}${"\u2591".repeat(width - filled)} ${clamped.toFixed(0)}%`.padEnd(20);
}
function formatQuotaReport(results) {
  if (results.length === 0) return "# Antigravity Quota\n\nNo accounts configured.";
  const lines = ["# Antigravity Quota", ""];
  for (const result of results) {
    const who = result.email ?? result.accountId.slice(0, 8);
    if (result.status === "error") {
      lines.push(`- **${who}**: error \u2014 ${result.error ?? "unknown"}`);
      continue;
    }
    if (result.status === "disabled") {
      lines.push(`- **${who}**: disabled`);
      continue;
    }
    if (result.buckets.length === 0) {
      lines.push(`- **${who}**: no quota windows reported`);
      continue;
    }
    lines.push(`**${who}**`);
    lines.push("");
    lines.push("| Window | Remaining | Resets in |");
    lines.push("| --- | --- | --- |");
    for (const bucket of result.buckets) {
      lines.push(`| ${bucket.label} (${bucket.window}) | ${bar(bucket.remainingPercentage)} | ${bucket.timeUntilResetFormatted} |`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// src/search.ts
var sessionCounter = 0;
var sessionPrefix = `search-${Date.now().toString(36)}`;
function requestId() {
  return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function parseAndFormat(data) {
  const response = data.response;
  const candidate = response?.candidates?.[0];
  if (!candidate) {
    const message = data.error?.message ?? response?.error?.message ?? "No results";
    return `## Search Error

${message}`;
  }
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").filter(Boolean).join("\n");
  const lines = ["## Search Results", "", text, ""];
  const queries = candidate.groundingMetadata?.webSearchQueries ?? [];
  const chunks = candidate.groundingMetadata?.groundingChunks ?? [];
  if (chunks.length > 0) {
    lines.push("### Sources");
    for (const chunk of chunks) {
      if (chunk.web?.uri && chunk.web?.title) lines.push(`- [${chunk.web.title}](${chunk.web.uri})`);
    }
    lines.push("");
  }
  if (queries.length > 0) {
    lines.push("### Queries");
    for (const q of queries) lines.push(`- "${q}"`);
  }
  return lines.join("\n").trimEnd();
}
async function executeSearch(args, access, projectId, signal) {
  const { query, urls, thinking = true } = args;
  let prompt = query;
  if (urls && urls.length > 0) prompt = `${query}

URLs to analyze:
${urls.join("\n")}`;
  const tools = [{ googleSearch: {} }];
  if (urls && urls.length > 0) tools.push({ urlContext: {} });
  const payload = {
    project: projectId,
    model: SEARCH_MODEL,
    userAgent: "antigravity",
    requestId: requestId(),
    request: {
      systemInstruction: { parts: [{ text: SEARCH_SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools,
      generationConfig: { temperature: 0, topP: 1, thinkingConfig: { thinkingBudget: thinking ? 8192 : 0 } },
      sessionId: `${sessionPrefix}-${++sessionCounter}`
    }
  };
  let lastError = "";
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: "POST",
        headers: antiGravityHeaders(access),
        body: JSON.stringify(payload),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        await response.body?.cancel();
        if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
        continue;
      }
      return parseAndFormat(await response.json());
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return `## Search Error

Search failed (${lastError}). Try a different query.`;
}

// src/self-update.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { promises as fs3, readFileSync, realpathSync } from "node:fs";
import { dirname as dirname2, join as join3, sep } from "node:path";
import { homedir as homedir2 } from "node:os";
import { fileURLToPath } from "node:url";

// src/update-payload.ts
import { createHash as createHash2, randomUUID as randomUUID3 } from "node:crypto";
import { promises as fs2 } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { gunzipSync } from "node:zlib";
var FILES = /* @__PURE__ */ new Set(["package.json", "lib/index.js", "lib/client.js", "cordis.patch.yml", "README.md", "docs/INSTALL.md", "docs/ARCHITECTURE.md", "docs/VALIDATION.md", "docs/SELF_UPDATE.md", "LICENSE"]);
function extractUpdate(tarball, integrity, version) {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) || `sha512-${createHash2("sha512").update(tarball).digest("base64")}` !== integrity) throw new Error("integrity-mismatch");
  const tar = gunzipSync(tarball, { maxOutputLength: 32 * 1024 * 1024 });
  const files = [];
  const seen = /* @__PURE__ */ new Set();
  let ended = false;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    const text = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const octal = (start, length) => {
      const value = text(start, length).trim();
      if (!/^[0-7]+$/.test(value)) throw new Error("invalid-archive");
      return parseInt(value, 8);
    };
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(148, 8) !== checksum) throw new Error("invalid-archive");
    const path = (text(345, 155) ? `${text(345, 155)}/` : "") + text(0, 100);
    const size = octal(124, 12);
    const type = header[156];
    const end = offset + 512 + size;
    if (end > tar.length) throw new Error("invalid-archive");
    if (type === 53) {
      if (!/^package\/(?:[A-Za-z0-9_-]+\/)*$/.test(path) || size !== 0) throw new Error("unsafe-archive");
    } else {
      const relative = path.startsWith("package/") ? path.slice(8) : "";
      if (type !== 0 && type !== 48 || !FILES.has(relative) || seen.has(relative)) throw new Error("unsafe-archive");
      seen.add(relative);
      files.push({ path: relative, data: tar.subarray(offset + 512, end) });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!ended || !["package.json", "lib/index.js", "lib/client.js", "cordis.patch.yml"].every((path) => seen.has(path))) throw new Error("incomplete-archive");
  const manifest2 = JSON.parse(files.find((file) => file.path === "package.json").data.toString("utf8"));
  if (manifest2.name !== "dsh-agy" || manifest2.version !== version) throw new Error("identity-mismatch");
  return files;
}
async function safeTarget(root, path) {
  if (!FILES.has(path)) throw new Error("unsafe-target");
  let cursor = root;
  for (const part of ["", ...path.split("/")]) {
    if (part) cursor = join2(cursor, part);
    try {
      const info = await fs2.lstat(cursor);
      if (info.isSymbolicLink() || cursor !== join2(root, path) && !info.isDirectory()) throw new Error("unsafe-target");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return join2(root, path);
}
async function installUpdate(root, dataDir, files) {
  await fs2.mkdir(dataDir, { recursive: true, mode: 448 });
  const lockPath = join2(dataDir, "update.lock");
  const lock = await fs2.open(lockPath, "wx", 384);
  const backup = join2(dataDir, `update-backup-${randomUUID3()}`);
  const touched = [];
  const written = /* @__PURE__ */ new Set();
  try {
    const incoming = JSON.parse(files.find((file) => file.path === "package.json").data.toString("utf8"));
    const installed = JSON.parse(await fs2.readFile(await safeTarget(root, "package.json"), "utf8"));
    if (incoming.name !== "dsh-agy" || installed.name !== "dsh-agy") throw new Error("identity-mismatch");
    const parts = (version) => {
      if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("invalid-version");
      const values = version.split(".").map(Number);
      if (!values.every(Number.isSafeInteger)) throw new Error("invalid-version");
      return values;
    };
    const next = parts(incoming.version), previous = parts(installed.version);
    const different = next.findIndex((part, index) => part !== previous[index]);
    if (different === -1 || next[different] < previous[different]) throw new Error("package-version-changed");
    files = [...files].sort((left, right) => Number(left.path === "package.json") - Number(right.path === "package.json"));
    const targets = await Promise.all(files.map((file) => safeTarget(root, file.path)));
    await fs2.mkdir(backup, { mode: 448 });
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const target = targets[index];
      let original;
      try {
        original = await fs2.readFile(target);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (original) {
        const saved = join2(backup, file.path);
        await fs2.mkdir(dirname(saved), { recursive: true });
        await fs2.writeFile(saved, original, { mode: 384 });
      }
      touched.push({ target, original });
    }
    for (let index = 0; index < files.length; index++) {
      const target = targets[index];
      await fs2.mkdir(dirname(target), { recursive: true });
      const temp = `${target}.update-${randomUUID3()}`;
      try {
        await fs2.writeFile(temp, files[index].data, { flag: "wx", mode: 420 });
        await fs2.rename(temp, target);
        written.add(target);
      } finally {
        await fs2.rm(temp, { force: true });
      }
    }
  } catch (error) {
    for (const entry of touched) {
      if (!written.has(entry.target)) continue;
      if (entry.original) await fs2.writeFile(entry.target, entry.original);
      else await fs2.rm(entry.target, { force: true });
    }
    throw error;
  } finally {
    await lock.close();
    await fs2.rm(lockPath, { force: true });
  }
}

// src/self-update.ts
var DEFAULT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1e3;
var UpdateInputError = class extends Error {
};
function validateUpdateConfig(value, base) {
  if (Object.keys(value).some((key) => !["enabled", "intervalMs", "registryOrigin"].includes(key))) throw new UpdateInputError("Unknown update option");
  const next = { ...base, ...value };
  if (typeof next.enabled !== "boolean") throw new UpdateInputError("enabled must be boolean");
  if (typeof next.intervalMs !== "number" || !Number.isInteger(next.intervalMs) || next.intervalMs < 6e4 || next.intervalMs > 7 * 864e5) throw new UpdateInputError("intervalMs must be between 60000 and 604800000");
  if (typeof next.registryOrigin !== "string") throw new UpdateInputError("registryOrigin must be a string");
  if (next.registryOrigin) {
    let url;
    try {
      url = new URL(next.registryOrigin);
    } catch {
      throw new UpdateInputError("Invalid registry origin");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new UpdateInputError("Use an HTTPS registry origin without credentials, path, query or fragment");
    next.registryOrigin = url.origin;
  }
  return next;
}
function versionParts(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error("invalid-version");
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("invalid-version");
  return parts;
}
function newer(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}
function manifest(root) {
  return JSON.parse(readFileSync(join3(root, "package.json"), "utf8"));
}
function profileInstall(root) {
  try {
    const actual = realpathSync(root);
    const profiles = realpathSync(join3(process.env.DSH_HOME || join3(homedir2(), ".dsh"), "profiles")) + sep;
    return process.platform === "linux" ? actual.startsWith(profiles) : actual.toLowerCase().startsWith(profiles.toLowerCase());
  } catch {
    return false;
  }
}
function createSelfUpdater(options = {}) {
  const root = options.packageDir ?? dirname2(dirname2(fileURLToPath(import.meta.url)));
  const dataDir = options.dataDir ?? stateDir();
  const stateFile = join3(dataDir, "update-config.json");
  const current = manifest(root);
  if (current.name !== "dsh-agy") throw new Error("identity-mismatch");
  const runningVersion = String(current.version);
  versionParts(runningVersion);
  let config = validateUpdateConfig(options.config ?? {}, { enabled: false, intervalMs: DEFAULT_UPDATE_INTERVAL_MS, registryOrigin: "" });
  try {
    config = validateUpdateConfig(JSON.parse(readFileSync(stateFile, "utf8")), config);
  } catch {
  }
  const allowed = options.installAllowed ?? profileInstall(root);
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let latest = null;
  let lastCheckAt = null;
  let lastError = null;
  let pageVisited = false;
  let disposed = false;
  let revision = 0;
  let timer;
  let checkPending;
  let installPending;
  let installingManually = false;
  let configPending = Promise.resolve();
  const controllers = /* @__PURE__ */ new Set();
  function status() {
    let diskVersion = runningVersion;
    try {
      diskVersion = String(manifest(root).version);
      versionParts(diskVersion);
    } catch {
      lastError = "disk-version-unavailable";
    }
    return { ...config, runningVersion, diskVersion, latest, available: latest !== null && newer(latest, diskVersion), pendingRestart: diskVersion !== runningVersion, configured: !!config.registryOrigin, installAllowed: allowed, pausedForSettings: pageVisited, lastCheckAt, lastError };
  }
  async function download(url, limit) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 6e4);
    try {
      const response = await fetchImpl(url, { redirect: "error", signal: controller.signal, headers: { accept: "*/*" } });
      if (!response.ok || !response.body) throw new Error("download-failed");
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > limit) throw new Error("download-too-large");
          chunks.push(Buffer.from(result.value));
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  async function release() {
    if (!config.registryOrigin) throw new Error("source-not-configured");
    const body = JSON.parse((await download(`${config.registryOrigin}/dsh-agy/latest`, 1024 * 1024)).toString("utf8"));
    versionParts(body.version);
    if (body.name !== "dsh-agy" || typeof body.dist?.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(body.dist.integrity) || typeof body.dist.tarball !== "string") throw new Error("invalid-release");
    const url = new URL(body.dist.tarball);
    if (url.origin !== config.registryOrigin || url.username || url.password || url.hash || url.search) throw new Error("unsafe-download-origin");
    return { version: body.version, integrity: body.dist.integrity, url: url.href };
  }
  async function run(install, manual) {
    const started = revision;
    try {
      if (disposed) throw new Error("updater-disposed");
      if (install && !allowed) throw new Error("profile-install-required");
      const target = await release();
      if (started !== revision || disposed) return status();
      latest = target.version;
      lastCheckAt = now();
      lastError = null;
      if (!install || !status().available) return status();
      if (!manual && (!config.enabled || pageVisited)) return status();
      const archive = await download(target.url, 8 * 1024 * 1024);
      const files = extractUpdate(archive, target.integrity, target.version);
      const next = JSON.parse(files.find((file) => file.path === "package.json").data.toString("utf8"));
      for (const key of ["dependencies", "peerDependencies"]) if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) throw new Error("dependency-change-requires-manual-install");
      if (disposed || started !== revision || !manual && (!config.enabled || pageVisited)) return status();
      await (options.install ?? installUpdate)(root, dataDir, files);
    } catch (error) {
      if (!disposed && started === revision) {
        lastCheckAt = now();
        const message = error instanceof Error ? error.message : "";
        lastError = /^[a-z]+(?:-[a-z]+)+$/.test(message) ? message : "update-failed";
      }
    }
    return status();
  }
  function check() {
    checkPending ??= run(false, true).finally(() => {
      checkPending = void 0;
    });
    return checkPending;
  }
  function update(manual = true) {
    if (!manual && (!config.enabled || !config.registryOrigin || pageVisited || !allowed || disposed)) return Promise.resolve(status());
    if (manual && installPending && !installingManually) return installPending.then(() => update(true));
    if (!installPending) {
      installingManually = manual;
      installPending = run(true, manual).finally(() => {
        installPending = void 0;
        installingManually = false;
      });
    }
    return installPending;
  }
  function schedule() {
    clearTimeout(timer);
    if (disposed || !config.enabled || !config.registryOrigin || !allowed || pageVisited) return;
    timer = setTimeout(() => {
      void update(false).finally(schedule);
    }, config.intervalMs);
    timer.unref?.();
  }
  return {
    status,
    visitSettings() {
      pageVisited = true;
      schedule();
      return status();
    },
    check,
    update,
    configure(value) {
      const pending = configPending.then(async () => {
        if (disposed) throw new Error("updater-disposed");
        const next = validateUpdateConfig(value, config);
        await fs3.mkdir(dataDir, { recursive: true, mode: 448 });
        const temp = `${stateFile}.${randomUUID4()}.tmp`;
        try {
          await fs3.writeFile(temp, JSON.stringify(next, null, 2) + "\n", { flag: "wx", mode: 384 });
          await fs3.rename(temp, stateFile);
        } finally {
          await fs3.rm(temp, { force: true });
        }
        config = next;
        revision++;
        latest = null;
        lastError = null;
        schedule();
        return status();
      });
      configPending = pending.then(() => void 0, () => void 0);
      return pending;
    },
    start() {
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const controller of controllers) controller.abort();
    }
  };
}

// src/rpc.ts
var ROUTE_PREFIX = "/_dsh/dsh-agy";
var MAX_BODY_BYTES = 64 * 1024;
var RpcInputError = class extends Error {
};
function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  const readable = req;
  await new Promise((resolve, reject) => {
    readable.on("error", reject);
    readable.on("aborted", () => reject(new Error("Request aborted")));
    readable.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    readable.on("end", () => resolve());
  });
  if (size > MAX_BODY_BYTES) throw new RpcInputError("Request body too large");
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RpcInputError("Invalid JSON body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new RpcInputError("Expected a JSON object");
  return parsed;
}
function pathOf(req) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.pathname;
  const path = raw.startsWith(ROUTE_PREFIX) ? raw.slice(ROUTE_PREFIX.length) : raw;
  return { path, search: url.searchParams };
}
function registerRpc(webServer, connection, manager, options = {}) {
  return webServer.register({
    kind: "prefix",
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req);
      if (rejection !== void 0) {
        const status = typeof rejection === "number" ? rejection : 403;
        send(res, status, { error: status === 401 ? "authentication required" : "request rejected" });
        return;
      }
      try {
        if (!(req.url ?? "").split("?")[0]?.startsWith(`${ROUTE_PREFIX}/`)) {
          send(res, 404, { error: "not found" });
          return;
        }
        const { path, search } = pathOf(req);
        const method = req.method ?? "GET";
        if (method === "GET") {
          if (path === "/update/status") {
            if (!options.updater) {
              send(res, 503, { error: "Self-updater unavailable" });
              return;
            }
            send(res, 200, options.updater.visitSettings());
            return;
          }
          if (path === "/stats") {
            send(res, 200, options.stats?.snapshot() ?? { accounts: [] });
            return;
          }
          if (path === "/status") {
            send(res, 200, { accounts: await manager.list() });
            return;
          }
          if (path === "/poll") {
            const loginId = search.get("loginId") ?? "";
            send(res, 200, manager.pollLogin(loginId));
            return;
          }
          if (path === "/quota") {
            const qu = await manager.quotaAccounts();
            const results = [];
            for (const acc of qu) {
              if (!acc.enabled || !acc.access) {
                results.push({ accountId: acc.id, email: acc.email, status: acc.enabled ? "error" : "disabled", error: acc.enabled ? "token unavailable" : void 0, buckets: [] });
                continue;
              }
              results.push(await fetchAccountQuota({ id: acc.id, email: acc.email, refreshToken: "", projectId: acc.projectId, addedAt: 0, lastUsed: 0, enabled: acc.enabled }, acc.access));
            }
            send(res, 200, { report: formatQuotaReport(results) });
            return;
          }
          send(res, 404, { error: "not found" });
          return;
        }
        if (method === "POST") {
          const body = await readJsonBody(req);
          if (["/update/check", "/update/install", "/update/config"].includes(path)) {
            if (!options.updater) {
              send(res, 503, { error: "Self-updater unavailable" });
              return;
            }
            options.updater.visitSettings();
            if (path === "/update/install" && body.confirm !== true) throw new RpcInputError("Explicit confirm: true is required");
            const result = path === "/update/config" ? await options.updater.configure(body) : path === "/update/check" ? await options.updater.check() : await options.updater.update();
            send(res, 200, result);
            return;
          }
          if (path === "/refresh-models") {
            options.refreshModels?.();
            send(res, 202, { ok: true });
            return;
          }
          if (path === "/search") {
            if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 1e4) {
              send(res, 400, { error: "A non-empty query of at most 10000 characters is required" });
              return;
            }
            if (body.urls !== void 0 && (!Array.isArray(body.urls) || body.urls.length > 20 || !body.urls.every((url) => typeof url === "string" && /^https?:\/\//i.test(url)))) {
              send(res, 400, { error: "urls must contain at most 20 HTTP(S) URLs" });
              return;
            }
            const auth = await manager.resolveAuth();
            const report = await executeSearch({ query: body.query, urls: body.urls }, auth.token, auth.projectId);
            send(res, 200, { report });
            return;
          }
          if (path === "/login") {
            const start = await manager.startLogin();
            send(res, 200, start);
            return;
          }
          if (path === "/cancel-login") {
            if (typeof body.loginId !== "string" || !body.loginId) throw new RpcInputError("loginId is required");
            manager.cancelLogin(body.loginId);
            send(res, 200, { ok: true });
            return;
          }
          if (path === "/logout") {
            if (body.accountId !== void 0 && (typeof body.accountId !== "string" || !body.accountId)) throw new RpcInputError("Invalid accountId");
            const accountId = typeof body.accountId === "string" ? body.accountId : void 0;
            await manager.remove(accountId);
            send(res, 200, { ok: true });
            return;
          }
          if (path === "/activate") {
            if (typeof body.accountId !== "string" || !body.accountId) throw new RpcInputError("accountId is required");
            const accountId = typeof body.accountId === "string" ? body.accountId : "";
            const ok = await manager.setActive(accountId);
            send(res, ok ? 200 : 404, { ok });
            return;
          }
          send(res, 404, { error: "not found" });
          return;
        }
        send(res, 405, { error: "method not allowed" });
      } catch (error) {
        const inputError = error instanceof RpcInputError || error instanceof UpdateInputError;
        send(res, inputError ? 400 : 500, { error: inputError ? error.message : "The operation failed. Check account status and try again." });
      }
    }
  });
}

// src/stats.ts
var EngineStats = class {
  lastDiagnostic;
  diagnostic(value) {
    this.lastDiagnostic = { ...value, time: Date.now() };
  }
  accounts = /* @__PURE__ */ new Map();
  startedAt = Date.now();
  record(accountId, kind) {
    const entry = this.accounts.get(accountId) ?? { success: 0, rateLimits: 0, errors: 0 };
    entry[kind]++;
    this.accounts.set(accountId, entry);
  }
  snapshot() {
    return { startedAt: this.startedAt, lastDiagnostic: this.lastDiagnostic, accounts: [...this.accounts].map(([accountId, data]) => ({ accountId, ...data })) };
  }
};

// src/tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
var output = {
  schema: { type: "object", additionalProperties: false, properties: { report: { type: "string", required: true } } },
  render: (_args, value) => [{ type: "text", text: value.report }]
};
async function quotaReport(manager, signal) {
  signal?.throwIfAborted();
  const accounts = await manager.quotaAccounts();
  const results = [];
  for (const account of accounts) {
    signal?.throwIfAborted();
    if (!account.enabled || !account.access) {
      results.push({ accountId: account.id, email: account.email, status: account.enabled ? "error" : "disabled", buckets: [], error: account.enabled ? "token unavailable" : void 0 });
      continue;
    }
    results.push(await fetchAccountQuota({ id: account.id, email: account.email, refreshToken: "", projectId: account.projectId, addedAt: 0, lastUsed: 0, enabled: true }, account.access, signal));
  }
  signal?.throwIfAborted();
  return formatQuotaReport(results);
}
function registerTools(tools, manager, stats) {
  const disposers = [];
  try {
    disposers.push(tools.register(defineTool({
      name: "antigravity_quota",
      description: "Check Google Antigravity account quota, including five-hour and weekly windows.",
      parameters: {},
      output,
      execute: async (_args, context) => ({ report: await quotaReport(manager, context.signal) })
    })));
    disposers.push(tools.register(defineTool({
      name: "antigravity_stats",
      description: "Show Antigravity runtime request and account activity. No credentials are returned.",
      parameters: {},
      output,
      execute: async (_args, context) => {
        context.signal.throwIfAborted();
        return { report: JSON.stringify(stats.snapshot(), null, 2) };
      }
    })));
    disposers.push(tools.register(defineTool({
      name: "google_search",
      description: "Search Google and analyze optional URLs, returning an answer with source citations.",
      parameters: {
        query: { type: "string", required: true, description: "The search query" },
        urls: { type: "array", items: { type: "string" }, description: "HTTP(S) URLs to analyze" },
        thinking: { type: "boolean", description: "Enable additional reasoning (default true)" }
      },
      output,
      execute: async (args, context) => {
        context.signal.throwIfAborted();
        if (!args.query.trim() || args.query.length > 1e4) throw new Error("Search query must contain 1\u201310000 characters");
        if (args.urls && (args.urls.length > 20 || args.urls.some((url) => !/^https?:\/\//i.test(url)))) throw new Error("Provide at most 20 HTTP(S) URLs");
        const auth = await manager.resolveAuth();
        context.signal.throwIfAborted();
        return { report: await executeSearch(args, auth.token, auth.projectId, context.signal) };
      }
    })));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}

// src/index.ts
var name = "dsh-agy";
var inject = ["llm", "credentials", "tools"];
var DEFAULT_OAUTH_CREDENTIAL_REF = "GOOGLE_ANTIGRAVITY_OAUTH_CREDENTIAL";
var DEFAULT_DISPLAY_NAME = "Google Antigravity";
var DEFAULT_STREAM_IDLE_MS = 3e5;
var DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
var DEFAULT_IMAGE_PIXEL_BUDGET = 2048 * 2048;
var DEFAULT_IMAGE_MAX_BYTES = 1024 * 1024;
var Config = z.object({
  oauthCredentialEnv: z.string().role("credential-ref").default(DEFAULT_OAUTH_CREDENTIAL_REF),
  oauthClientConfigRef: z.string().role("credential-ref").default(DEFAULT_OAUTH_CLIENT_CONFIG_REF),
  displayName: z.string().default(DEFAULT_DISPLAY_NAME),
  streamIdleTimeoutMs: z.number().min(1).default(DEFAULT_STREAM_IDLE_MS),
  maxRequestImageBytes: z.number().min(1).default(DEFAULT_MAX_IMAGE_BYTES),
  requestImagePixelBudget: z.number().min(1).default(DEFAULT_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().min(1).default(DEFAULT_IMAGE_MAX_BYTES),
  autoUpdateEnabled: z.boolean().default(false),
  autoUpdateIntervalMs: z.number().min(6e4).max(6048e5).default(DEFAULT_UPDATE_INTERVAL_MS),
  updateRegistryOrigin: z.string().default("")
});
function resolveConfig(config) {
  return {
    oauthCredentialEnv: config.oauthCredentialEnv ?? DEFAULT_OAUTH_CREDENTIAL_REF,
    oauthClientConfigRef: config.oauthClientConfigRef ?? DEFAULT_OAUTH_CLIENT_CONFIG_REF,
    displayName: config.displayName ?? DEFAULT_DISPLAY_NAME,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_MS,
    maxRequestImageBytes: config.maxRequestImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    requestImagePixelBudget: config.requestImagePixelBudget ?? DEFAULT_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: config.requestImageMaxBytes ?? DEFAULT_IMAGE_MAX_BYTES
  };
}
var requestOverrideAuth = {
  name: "Google Antigravity OAuth request override",
  resolve: ({ credential }) => Promise.resolve(
    credential?.key === void 0 || credential.key.length === 0 ? void 0 : { auth: { apiKey: credential.key }, source: "OAuth" }
  )
};
function providerFor(manager, config, models, oauth) {
  const resolvedModels = models.map((model) => ({ ...model, provider: PROVIDER, baseUrl: ENDPOINTS[0] }));
  return createProvider({
    id: PROVIDER,
    name: config.displayName,
    baseUrl: ENDPOINTS[0],
    auth: { apiKey: requestOverrideAuth, oauth },
    models: resolvedModels,
    api: createAntiGravityApi(manager)
  });
}
function profileFor(manager, config, models, oauth) {
  return /* @__PURE__ */ new Map([[PROVIDER, {
    provider: PROVIDER,
    displayName: config.displayName,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    maxRequestImageBytes: config.maxRequestImageBytes,
    requestImagePixelBudget: config.requestImagePixelBudget,
    requestImageMaxBytes: config.requestImageMaxBytes,
    retryPolicy: resolveRetryPolicy(void 0, "dsh-agy: retryPolicy"),
    configuredMaxTokens: /* @__PURE__ */ new Map(),
    modelErrors: /* @__PURE__ */ new Map(),
    piProvider: providerFor(manager, config, models, oauth)
  }]]);
}
function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const updater = createSelfUpdater({ config: {
    enabled: rawConfig.autoUpdateEnabled ?? false,
    intervalMs: rawConfig.autoUpdateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS,
    registryOrigin: rawConfig.updateRegistryOrigin ?? ""
  } });
  ctx.effect(() => {
    updater.start();
    return () => updater.dispose();
  }, "dsh-agy: package self-update");
  const oauth = createAntiGravityOAuth(() => resolveOAuthClientConfig(ctx.credentials, config.oauthClientConfigRef));
  const manager = new AccountManager({
    oauth,
    credentials: ctx.credentials,
    credentialRef: credentialRef(config.oauthCredentialEnv),
    clientConfigRef: config.oauthClientConfigRef
  });
  const stats = new EngineStats();
  manager.reportDiagnostic = (diagnostic) => stats.diagnostic(diagnostic);
  const reportSuccess = manager.reportSuccess.bind(manager);
  manager.reportSuccess = (accountId) => {
    stats.record(accountId, "success");
    reportSuccess(accountId);
  };
  const reportRateLimit = manager.reportRateLimit.bind(manager);
  manager.reportRateLimit = (accountId, ...args) => {
    stats.record(accountId, "rateLimits");
    reportRateLimit(accountId, ...args);
  };
  const reportError = manager.reportError.bind(manager);
  manager.reportError = (accountId) => {
    stats.record(accountId, "errors");
    reportError(accountId);
  };
  void manager.init().catch(() => ctx.logger.warn("dsh-agy: account storage could not be initialized"));
  let profiles = profileFor(manager, config, maintainedModels, oauth);
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => manager.resolveApiKey(),
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
    resolveAttachments: () => ctx.get("attachments")
  });
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter);
  ctx.effect(() => () => registration(), "dsh-agy: provider registration");
  ctx.effect(() => () => manager.dispose(), "dsh-agy: account manager");
  ctx.effect(() => registerTools(ctx.tools, manager, stats), "dsh-agy: agent tools");
  const controller = new AbortController();
  let refreshing;
  const refresh = () => {
    refreshing ??= (async () => {
      try {
        const auth = await manager.resolveAuth();
        const live = await fetchAvailableModels(auth.token, auth.projectId, controller.signal);
        controller.signal.throwIfAborted();
        profiles = profileFor(manager, config, live, oauth);
        registration.replace([PROVIDER]);
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.logger.info("dsh-agy: live model refresh unavailable; keeping the maintained catalog");
          ctx.logger.debug("dsh-agy: catalog refresh failed");
        }
      } finally {
        refreshing = void 0;
      }
    })();
  };
  ctx.effect(() => {
    const timers = [setTimeout(refresh, 0), setTimeout(refresh, 250)];
    return () => {
      for (const timer of timers) clearTimeout(timer);
      controller.abort();
    };
  }, "dsh-agy: live refresh");
  ctx.on("credentials/reference-updated", ((ref) => {
    if (ref === config.oauthCredentialEnv) refresh();
  }));
  ctx.on("credentials/updated", ((ref) => {
    if (ref === config.oauthCredentialEnv) refresh();
  }));
  ctx.inject(["connection", "webServer"], (webCtx) => {
    const dispose = registerRpc(webCtx.webServer, webCtx.connection, manager, { refreshModels: refresh, stats, updater });
    webCtx.effect(() => dispose, "dsh-agy: rpc");
  });
}
var index_default = { name, inject, Config, apply };
export {
  Config,
  PROVIDER,
  apply,
  index_default as default,
  inject,
  name
};
