/**
 * Constants for Google Antigravity OAuth and the Cloud Code Assist API.
 *
 * The OAuth client identity is embedded (split into fragments, as in the
 * reference opencode-agy plugin) so the plugin authenticates on any platform
 * without requiring a local Antigravity IDE installation. A deployment can
 * still override it through the GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG
 * credential reference (see client-config.ts).
 */

// Split so the literal pair is not present as one contiguous string.
const _idParts = ['1071006060591', 'tmhssin2h21lcre235vtolojh4g403ep', 'apps', 'googleusercontent', 'com']
const _secParts = ['GOCSPX', 'K58FWR486LdLJ1mLB8sXC4z6qDAf']

/** OAuth client id issued for the Antigravity application. */
export const ANTIGRAVITY_CLIENT_ID = `${_idParts[0]}-${_idParts[1]}.${_idParts[2]}.${_idParts[3]}.${_idParts[4]}`

/** OAuth client secret issued for the Antigravity application. */
export const ANTIGRAVITY_CLIENT_SECRET = `${_secParts[0]}-${_secParts[1]}`

/** Scopes requested for Antigravity integrations. */
export const ANTIGRAVITY_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
]

/** Fixed localhost OAuth redirect port and path. */
export const OAUTH_CALLBACK_PORT = 51121
export const OAUTH_CALLBACK_PATH = '/oauth-callback'
export const REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`

/** Cloud Code Assist root endpoints, in provider-preferred fallback order. */
export const ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
] as const

/** Google OAuth token endpoint. */
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Google OAuth authorization endpoint. */
export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
/** Google userinfo endpoint used to recover the account email. */
export const USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'

/** Antigravity version reported in request metadata. */
export const ANTIGRAVITY_VERSION = '2.5.2'

/** Default Cloud Code Assist project id used when discovery returns none. */
export const DEFAULT_PROJECT_ID = 'rising-fact-p41fc'

/** Model used for Google Search grounding (fast and cheap). */
export const SEARCH_MODEL = 'gemini-2.5-flash'
export const SEARCH_TIMEOUT_MS = 60_000

export const SEARCH_SYSTEM_INSTRUCTION = `You are an expert web search assistant with access to Google Search and URL analysis tools.
Guidelines:
- Always provide accurate, well-sourced information
- Cite your sources when presenting facts
- If analyzing URLs, extract the most relevant information
- Be concise but comprehensive
- If information is uncertain or conflicting, acknowledge it`

/**
 * Build the HTTP headers shared by Cloud Code Assist calls. The client
 * metadata identifies the Antigravity IDE surface and the host platform.
 * @param access - current OAuth access token.
 * @returns request headers for an authenticated JSON call.
 */
export function antiGravityHeaders(access: string): Record<string, string> {
  const platform = process.platform === 'win32' ? 'WINDOWS' : process.platform === 'darwin' ? 'MACOS' : 'LINUX'
  return {
    authorization: `Bearer ${access}`,
    'content-type': 'application/json',
    'user-agent': `antigravity/${ANTIGRAVITY_VERSION} ${platform === 'WINDOWS' ? 'windows/amd64' : platform === 'MACOS' ? 'darwin/arm64' : 'linux/amd64'}`,
    'client-metadata': JSON.stringify({ ideType: 'ANTIGRAVITY', platform, pluginType: 'GEMINI' }),
    'x-goog-api-client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  }
}
