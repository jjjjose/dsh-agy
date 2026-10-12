// src/index.ts
import { createProvider, defaultProviderAuthContext, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";

// src/api.ts
import { calculateCost, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { convertMessages, convertTools, isThinkingPart, mapStopReasonString, retainThoughtSignature } from "@earendil-works/pi-ai/api/google-shared";

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
  const request = {
    contents: convertMessages(googleModel, context),
    ...options.sessionId === void 0 ? {} : { sessionId: options.sessionId }
  };
  if (context.systemPrompt !== void 0) {
    request.systemInstruction = { role: "user", parts: [{ text: context.systemPrompt }] };
  }
  const generationConfig = {};
  if (options.temperature !== void 0) generationConfig.temperature = options.temperature;
  if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = options.maxTokens;
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
  if (context.tools !== void 0 && context.tools.length > 0) {
    request.tools = convertTools(context.tools, model.id.startsWith("claude-"));
  }
  return {
    project: projectId,
    model: model.id,
    request,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent-${crypto.randomUUID()}`
  };
}
async function openResponse(model, context, options, auth, provider) {
  let payload = buildEnvelope(model, context, options, auth.projectId);
  const replacement = await options.onPayload?.(payload, model);
  if (replacement != null) payload = replacement;
  const body = JSON.stringify(payload);
  let current = auth;
  for (let attempt = 0; attempt < 3; attempt++) {
    let lastStatus;
    for (const endpoint of ENDPOINTS) {
      const headers = {
        ...Object.fromEntries(Object.entries(options.headers ?? {}).filter((e) => e[1] !== null)),
        ...antiGravityHeaders(current.token),
        accept: "text/event-stream",
        ...model.id.startsWith("claude-") ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}
      };
      const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers,
        body,
        ...options.signal === void 0 ? {} : { signal: options.signal }
      });
      const headerRecord = Object.fromEntries(response.headers);
      await options.onResponse?.({ status: response.status, headers: headerRecord }, model);
      if (response.ok) {
        if (current.accountId) provider.reportSuccess(current.accountId);
        return { response, auth: current };
      }
      lastStatus = response.status;
      if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
    }
    if (current.accountId && (lastStatus === 429 || lastStatus === 403)) {
      provider.reportRateLimit(current.accountId);
      const next = await provider.afterRateLimit(current.accountId);
      if (next) {
        current = next;
        continue;
      }
    }
    throw new Error(`Antigravity inference failed with HTTP ${lastStatus ?? "unknown"}`);
  }
  throw new Error("Antigravity inference failed after exhausting retries");
}
function streamAntiGravity(model, context, options, provider) {
  const stream = createAssistantMessageEventStream();
  const output = {
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
    try {
      const auth = parseRequestAuth(options.apiKey);
      const opened = await openResponse(model, context, options, auth, provider);
      const response = opened.response;
      if (response.body === null) throw new Error("Antigravity returned no response stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let started = false;
      let current;
      const ensureStarted = () => {
        if (started) return;
        started = true;
        stream.push({ type: "start", partial: output });
      };
      const closeCurrent = () => {
        if (current === void 0) return;
        const index = output.content.length - 1;
        if (current.type === "text") stream.push({ type: "text_end", contentIndex: index, content: current.text, partial: output });
        else stream.push({ type: "thinking_end", contentIndex: index, content: current.thinking, partial: output });
        current = void 0;
      };
      const consume = (chunk) => {
        const data = chunk.response;
        if (data === void 0) return;
        if (output.responseId === void 0 && data.responseId !== void 0) output.responseId = data.responseId;
        const candidate = data.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.text !== void 0) {
            const thinking = isThinkingPart(part);
            let active = current;
            if (current === void 0 || thinking && current.type !== "thinking" || !thinking && current.type !== "text") {
              closeCurrent();
              const created = thinking ? { type: "thinking", thinking: "", ...part.thoughtSignature === void 0 ? {} : { thinkingSignature: part.thoughtSignature } } : { type: "text", text: "" };
              current = created;
              active = created;
              output.content.push(created);
              ensureStarted();
              const index2 = output.content.length - 1;
              stream.push(thinking ? { type: "thinking_start", contentIndex: index2, partial: output } : { type: "text_start", contentIndex: index2, partial: output });
            }
            const index = output.content.length - 1;
            if (active === void 0) throw new Error("Antigravity stream block was not initialized");
            if (active.type === "thinking") {
              active.thinking += part.text;
              const signature = retainThoughtSignature(active.thinkingSignature, part.thoughtSignature);
              if (signature !== void 0) active.thinkingSignature = signature;
              stream.push({ type: "thinking_delta", contentIndex: index, delta: part.text, partial: output });
            } else {
              active.text += part.text;
              stream.push({ type: "text_delta", contentIndex: index, delta: part.text, partial: output });
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
            output.content.push(toolCall);
            ensureStarted();
            const index = output.content.length - 1;
            stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
            stream.push({ type: "toolcall_delta", contentIndex: index, delta: JSON.stringify(toolCall.arguments), partial: output });
            stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
          }
        }
        if (candidate?.finishReason !== void 0) output.stopReason = mapStopReasonString(candidate.finishReason);
        if (output.content.some((block) => block.type === "toolCall")) output.stopReason = "toolUse";
        const usage = data.usageMetadata;
        if (usage !== void 0) {
          const cacheRead = usage.cachedContentTokenCount ?? 0;
          output.usage = {
            input: Math.max(0, (usage.promptTokenCount ?? 0) - cacheRead),
            output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            reasoning: usage.thoughtsTokenCount ?? 0,
            cacheRead,
            cacheWrite: 0,
            totalTokens: usage.totalTokenCount ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          };
          calculateCost(model, output.usage);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const text = line.slice(5).trim();
          if (text.length === 0) continue;
          consume(JSON.parse(text));
        }
      }
      closeCurrent();
      if (output.content.length === 0) throw new Error("Antigravity returned an empty response");
      const reason = output.stopReason === "toolUse" || output.stopReason === "length" ? output.stopReason : "stop";
      stream.push({ type: "done", reason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
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
    const text = await response.text().catch(() => "");
    throw new Error(`Antigravity token exchange failed with HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }
  return response.json();
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
  const code = await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== OAUTH_CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      const receivedCode = url.searchParams.get("code");
      if (url.searchParams.get("state") !== state || receivedCode === null) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Antigravity OAuth callback is invalid.");
        server.close();
        reject(new Error("Antigravity OAuth state or code is invalid"));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Antigravity login completed. You may close this page.");
      server.close();
      resolve(receivedCode);
    });
    server.on("error", (error) => {
      reject(new Error(`Could not start the Antigravity OAuth callback on port ${OAUTH_CALLBACK_PORT}: ${error.message}. Close other Antigravity sessions and retry.`));
    });
    server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1");
    interaction.signal?.addEventListener("abort", () => {
      server.close();
      reject(new Error("Antigravity OAuth was cancelled"));
    }, { once: true });
  });
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
  const notifyEvent = { type: "auth_url", url: auth.toString(), instructions: "Complete the Google Antigravity authorization in your browser." };
  interaction.notify(notifyEvent);
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
import { randomUUID } from "node:crypto";

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
async function refreshAccountAccess(refreshToken, clientConfig) {
  let response;
  try {
    response = await fetch(TOKEN_URL, {
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
    if (code === "invalid_grant" || response.status === 400 || response.status === 401) {
      return { kind: "revoked" };
    }
    return { kind: "error", message: description ?? text ?? `HTTP ${response.status}`, status: response.status };
  }
  const payload = await response.json();
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
    const hours = (now - state.updatedAt) / 36e5;
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
    const minutes = (now - state.updatedAt) / 6e4;
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
  return withLock(async () => {
    const dir = stateDir();
    await fs.mkdir(dir, { recursive: true });
    const target = poolPath();
    const tmp = `${target}.${Date.now().toString(36)}.tmp`;
    const content = JSON.stringify(storage, null, 2);
    await fs.writeFile(tmp, content, { encoding: "utf8", mode: 384 });
    await fs.rename(tmp, target);
  });
}
async function clearPool() {
  await withLock(async () => {
    try {
      await fs.unlink(poolPath());
    } catch {
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
  health = new HealthTracker();
  bucket = new TokenBucket();
  attempt;
  /** Load the pool from disk (idempotent). */
  async init() {
    if (this.loaded) return;
    const pool = await loadPool();
    this.accounts = pool.accounts;
    this.activeId = pool.activeId;
    this.loaded = true;
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
    this.attempt?.controller.abort("A newer Antigravity login started");
    const attempt = { id: randomUUID(), controller: new AbortController(), status: { kind: "pending" } };
    this.attempt = attempt;
    const url = Promise.withResolvers();
    const notify = (event) => {
      if (event.type === "auth_url" && typeof event.url === "string") url.resolve(event.url);
    };
    const piInteraction = {
      signal: attempt.controller.signal,
      notify,
      prompt: () => Promise.reject(new Error("Antigravity OAuth does not support interactive prompts"))
    };
    void this.options.oauth.login(piInteraction).then(async (credential) => {
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return;
      await this.addCredential(credential);
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
  /** Remove one account, or all when `accountId` is undefined. */
  async remove(accountId) {
    await this.init();
    if (accountId === void 0) {
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
    if (!account) return false;
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
      chosenId = [...pool].sort((a, b) => a.lastUsed - b.lastUsed)[0]?.id;
    }
    if (chosenId === void 0) throw new Error("No usable Antigravity account is available right now.");
    const account = this.accounts.find((a) => a.id === chosenId);
    if (!account) throw new Error("Antigravity account selection failed.");
    const access = await this.ensureAccess(account);
    account.lastUsed = Date.now();
    this.bucket.consume(account.id);
    await this.persist();
    return { token: access, projectId: account.projectId, accountId: account.id };
  }
  /** Ensure the account has a valid access token, refreshing when expired. */
  async ensureAccess(account) {
    if (account.accessToken && (account.accessExpires ?? 0) > Date.now() + 3e4) {
      return account.accessToken;
    }
    const config = await this.clientConfig();
    const result = await refreshAccountAccess(account.refreshToken, config);
    if (result.kind === "revoked") {
      account.enabled = false;
      await this.persist();
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
  reportRateLimit(accountId) {
    const account = this.accounts.find((a) => a.id === accountId);
    if (account) {
      account.rateLimitedUntil = { ...account.rateLimitedUntil ?? {}, all: Date.now() + RATE_LIMIT_WINDOW_MS };
      void this.persist();
    }
    this.health.rateLimited(accountId);
  }
  reportSuccess(accountId) {
    this.health.success(accountId);
  }
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
      this.activeId = existing.id;
    } else {
      const account = {
        id: randomUUID(),
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
    if (!account) return;
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
  const output = family === "gpt" ? 8192 : 65536;
  return {
    id,
    name: name2,
    api: "google-antigravity",
    provider: PROVIDER,
    baseUrl: ENDPOINTS[0],
    reasoning: true,
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
    maxTokens: output
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
  descriptor("claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)", "claude", "high"),
  descriptor("claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)", "claude", "high"),
  descriptor("gpt-oss-120b-medium", "GPT-OSS 120B (Medium)", "gpt", "medium")
];
function parseAvailableModels(payload) {
  if (typeof payload !== "object" || payload === null || typeof payload.models !== "object") {
    throw new Error("Antigravity model response must contain a models object");
  }
  const live = payload.models;
  return maintainedModels.flatMap((model) => {
    const entry = live[model.id];
    if (entry === void 0) return [];
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
    if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
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
async function fetchSummary(access, projectId) {
  let lastError = "";
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
        method: "POST",
        headers: antiGravityHeaders(access),
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
      if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Antigravity quota summary failed (${lastError})`);
}
async function fetchAccountQuota(account, access) {
  if (!account.enabled) return { accountId: account.id, email: account.email, status: "disabled", buckets: [] };
  try {
    const summary = await fetchSummary(access, account.projectId);
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
          window: bucket.window || bucket.bucketId || "unknown",
          label: bucket.displayName || bucket.bucketId || `${group.displayName ?? "Limit"}`,
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

// src/rpc.ts
var ROUTE_PREFIX = "/_dsh/dsh-agy";
var MAX_BODY_BYTES = 64 * 1024;
function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  const readable = req;
  await new Promise((resolve) => {
    readable.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    readable.on("end", () => resolve());
  });
  if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return {};
  const parsed = JSON.parse(text);
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}
function pathOf(req) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.pathname;
  const path = raw.startsWith(ROUTE_PREFIX) ? raw.slice(ROUTE_PREFIX.length) : raw;
  return { path, search: url.searchParams };
}
function registerRpc(webServer, connection, manager) {
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
        const { path, search } = pathOf(req);
        const method = req.method ?? "GET";
        if (method === "GET") {
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
          if (path === "/login") {
            const start = await manager.startLogin();
            send(res, 200, start);
            return;
          }
          if (path === "/logout") {
            const accountId = typeof body.accountId === "string" ? body.accountId : void 0;
            await manager.remove(accountId);
            send(res, 200, { ok: true });
            return;
          }
          if (path === "/activate") {
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
        send(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
}

// src/index.ts
var name = "dsh-agy";
var inject = ["llm", "credentials"];
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
  requestImageMaxBytes: z.number().min(1).default(DEFAULT_IMAGE_MAX_BYTES)
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
    piProvider: providerFor(manager, config, models, oauth)
  }]]);
}
function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const oauth = createAntiGravityOAuth(() => resolveOAuthClientConfig(ctx.credentials, config.oauthClientConfigRef));
  const manager = new AccountManager({
    oauth,
    credentials: ctx.credentials,
    credentialRef: credentialRef(config.oauthCredentialEnv),
    clientConfigRef: config.oauthClientConfigRef
  });
  void manager.init();
  let profiles = profileFor(manager, config, maintainedModels, oauth);
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => manager.resolveApiKey(),
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
    resolveAttachments: () => ctx.get("attachments")
  });
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter);
  const controller = new AbortController();
  let refreshing;
  const refresh = () => {
    refreshing ??= (async () => {
      try {
        const auth = await manager.resolveAuth();
        const live = await fetchAvailableModels(auth.token, auth.projectId, controller.signal);
        profiles = profileFor(manager, config, live, oauth);
        registration.replace([PROVIDER]);
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.logger.info("dsh-agy: live model refresh unavailable; keeping the maintained catalog");
          ctx.logger.debug(error);
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
  ctx.inject(["connection", "webServer"], (webCtx) => {
    const dispose = registerRpc(webCtx.webServer, webCtx.connection, manager);
    webCtx.effect(() => dispose, "dsh-agy: rpc");
  });
}
export {
  Config,
  PROVIDER,
  apply,
  inject,
  name
};
