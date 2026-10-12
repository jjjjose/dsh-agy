# Installing dsh-agy

`dsh-agy` ships a **prebuilt `lib/`**, so there is nothing to compile. You install it like any other Harness plugin.

## DeepSeek Desktop

1. Open **DeepSeek Desktop**.
2. Go to **Plugins**.
3. Click **Add plugin**.
4. Provide the plugin source:
   - a **local folder** containing this package, or
   - a **git URL** (e.g. `github:you/dsh-agy`), or
   - an **npm** name once published.
5. Wait for the Harness to install the package and its `dependencies` (`@earendil-works/pi-ai`). The `@deepseek-ai/*` host packages are provided by the Harness itself and are **not** downloaded from npm.
6. The plugin card **Google Antigravity** appears. Open its settings page.
7. Click **Sign in** and complete the Google OAuth flow in your browser (a `http://localhost:51121/oauth-callback` page confirms success — you can close it).
8. The provider **Google Antigravity** and its models appear in the model picker.

### Verifying

After signing in, the settings page lists your account(s). Use **Show quota** to confirm connectivity (you should see your dual-window usage). Then select any `gemini-*`, `claude-*`, or `gpt-oss-*` model and send a message.

## CLI (`web` profile)

If you use the Harness CLI instead of the Desktop app:

```bash
npx @deepseek-ai/dsh web     # starts the Web UI on 127.0.0.1:3080
```

Then add the plugin through the Web UI's plugin manager (same flow as Desktop). The plugin stores its account pool under `$DSH_HOME` (default `~/.dsh`), so the same accounts are shared between CLI and Desktop as long as they use the same home directory.

## Adding a second account

Open the plugin settings page and click **Add** / **Sign in** again, then choose a different Google account. Use **Make active** to pin a specific account, or leave rotation automatic. **Remove** / **Disconnect all** delete the stored tokens from this device.

## Overriding the Google OAuth client (optional)

The plugin embeds a working Google client so most users never configure anything. If that client is ever revoked, or you want to use your own:

1. Create an OAuth client of type **Desktop app** in Google Cloud Console with the Cloud Code Assist scopes.
2. Store a JSON document as a credential named `GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG`:

   ```json
   { "clientId": "....apps.googleusercontent.com", "clientSecret": "GOCSPX-..." }
   ```

The plugin uses it in place of the embedded identity for login and refresh.

## Troubleshooting

- **"Could not start the Antigravity OAuth callback on port 51121"** — another process (often a previous login) is using the fixed callback port. Close other Antigravity sessions and retry.
- **"was revoked; sign in again"** — Google invalidated the stored refresh token. Remove the account and sign in again.
- **Models missing** — the visible catalog is your account's `fetchAvailableModels` result. If discovery fails (network/region), the maintained fallback catalog is shown instead.
- **Windows path** — the account pool is under `%USERPROFILE%\.dsh\dsh-agy\accounts.json` unless you set `DSH_HOME`.
