window.__ModuleLoader__.load({ id: "dsh-agy", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var React = __toESM(require("react"), 1);
var PREFIX = "/_dsh/dsh-agy";
var MUTATING = /* @__PURE__ */ new Set(["login", "logout", "activate"]);
function rpc(method, args) {
  const url = `${PREFIX}/${method}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15e3);
  const mutating = MUTATING.has(method);
  return fetch(url, {
    method: mutating ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: mutating ? JSON.stringify(args ?? {}) : void 0,
    signal: controller.signal
  }).then((r) => r.json().catch(() => ({})).then((body) => {
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  })).finally(() => window.clearTimeout(timeout));
}
function Row(props) {
  return /* @__PURE__ */ React.createElement("div", { className: "agy-row" }, /* @__PURE__ */ React.createElement("div", { className: "agy-rowText" }, /* @__PURE__ */ React.createElement("div", { className: "agy-rowTitle" }, props.title), props.desc ? /* @__PURE__ */ React.createElement("div", { className: "agy-rowDesc" }, props.desc) : null), props.controls ? /* @__PURE__ */ React.createElement("div", { className: "agy-controls" }, props.controls) : null);
}
function Button(props) {
  const cls = "agy-btn" + (props.danger ? " agy-btn--danger" : "");
  return /* @__PURE__ */ React.createElement("button", { type: "button", className: cls, disabled: props.disabled, onClick: props.onClick }, props.children);
}
function installStyles() {
  if (document.querySelector('style[data-plugin-css="dsh-agy"]')) return;
  const style = document.createElement("style");
  style.dataset.plugin = "dsh-agy";
  style.dataset.pluginCss = "dsh-agy";
  style.textContent = `
    .agy-page { display: flex; flex-direction: column; width: 100%; max-width: 100%; gap: 12px; color: var(--dsw-alias-label-primary); }
    .agy-page, .agy-page * { box-sizing: border-box; }
    .agy-list { display: flex; flex-direction: column; width: 100%; }
    .agy-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 12px 2px; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16)); }
    .agy-row:last-child { border-bottom: 0; }
    .agy-row:first-child { padding-top: 0; }
    .agy-rowText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .agy-rowTitle { font-size: 13.5px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
    .agy-rowDesc { font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
    .agy-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
    .agy-btn { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; height: 28px; border: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); background: transparent; border-radius: 14px; padding: 0 10px; font-size: 12px; }
    .agy-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
    .agy-btn:disabled { opacity: 0.4; cursor: default; }
    .agy-btn--danger { color: var(--dsw-alias-state-error-primary, #d92d20); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 30%, transparent); }
    .agy-pill { display: inline-flex; align-items: center; gap: 6px; height: 28px; border-radius: 14px; padding: 0 10px; font-size: 12px; }
    .agy-pill--ok { color: var(--dsw-alias-state-success-primary, #087f5b); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #087f5b) 10%, transparent); }
    .agy-pill--warn { color: var(--dsw-alias-state-error-primary, #d92d20); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 10%, transparent); }
    .agy-error { color: var(--dsw-alias-state-error-primary, #d92d20); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .agy-note { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
    .agy-quota { width: 100%; margin: 0; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
    @media (max-width: 600px) { .agy-row { align-items: flex-start; } .agy-controls { margin-left: 0; } }
  `;
  document.head.appendChild(style);
}
function AntigravityPage() {
  const [accounts, setAccounts] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [quota, setQuota] = React.useState("");
  const [quotaLoading, setQuotaLoading] = React.useState(false);
  const pollRef = React.useRef(null);
  const activeRef = React.useRef(true);
  const load = React.useCallback(() => {
    rpc("status").then((body) => {
      if (activeRef.current) {
        setAccounts(body.accounts ?? []);
        setError("");
      }
    }).catch(() => {
      if (activeRef.current) setError("Could not reach the host.");
    });
  }, []);
  React.useEffect(() => {
    activeRef.current = true;
    load();
    const timer = window.setInterval(load, 5e3);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [load]);
  const startLogin = React.useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError("");
    rpc("login").then((res) => {
      if (res.authorizationUrl) window.open(res.authorizationUrl, "_blank");
      const loginId = res.loginId;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => {
        fetch(`${PREFIX}/poll?loginId=${encodeURIComponent(loginId)}`).then((r) => r.json()).then((st) => {
          if (!activeRef.current) return;
          if (st.kind === "succeeded") {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
            load();
          } else if (st.kind === "failed" || st.kind === "cancelled") {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
            setError(st.kind === "failed" ? st.message : "Login cancelled.");
          }
        }).catch(() => void 0);
      }, 2e3);
    }).catch((e) => {
      setBusy(false);
      setError(e.message);
    });
  }, [busy, load]);
  const logout = React.useCallback((accountId) => {
    if (!window.confirm(accountId ? "Remove this Antigravity account from this device?" : "Disconnect all Antigravity accounts?")) return;
    rpc("logout", accountId ? { accountId } : {}).then(() => load()).catch((e) => setError(e.message));
  }, [load]);
  const activate = React.useCallback((accountId) => {
    rpc("activate", { accountId }).then(() => load()).catch((e) => setError(e.message));
  }, [load]);
  const showQuota = React.useCallback(() => {
    setQuotaLoading(true);
    rpc("quota").then((b) => {
      setQuota(b.report ?? "");
    }).catch((e) => setError(e.message)).finally(() => setQuotaLoading(false));
  }, []);
  if (accounts === null) {
    return /* @__PURE__ */ React.createElement("div", { className: "agy-page" }, /* @__PURE__ */ React.createElement("p", { className: "agy-note" }, "Loading\u2026"));
  }
  const rows = [];
  if (accounts.length === 0) {
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "empty", title: "No accounts", desc: "Sign in with your Google account to use Antigravity (Gemini / Claude / GPT-OSS) models.", controls: /* @__PURE__ */ React.createElement(Button, { onClick: startLogin, disabled: busy }, busy ? "Opening browser\u2026" : "Sign in") }));
  } else {
    for (const a of accounts) {
      const pill = a.active ? /* @__PURE__ */ React.createElement("span", { className: "agy-pill agy-pill--ok" }, "active") : a.rateLimited ? /* @__PURE__ */ React.createElement("span", { className: "agy-pill agy-pill--warn" }, "rate-limited") : null;
      const controls = /* @__PURE__ */ React.createElement(React.Fragment, null, pill, !a.active ? /* @__PURE__ */ React.createElement(Button, { onClick: () => activate(a.id) }, "Make active") : null, /* @__PURE__ */ React.createElement(Button, { onClick: startLogin, disabled: busy }, "Add"), /* @__PURE__ */ React.createElement(Button, { danger: true, onClick: () => logout(a.id) }, "Remove"));
      const state = [a.enabled ? null : "disabled", a.rateLimited ? "rate-limited" : null, a.coolingDown ? "cooling down" : null].filter(Boolean).join(" \xB7 ");
      rows.push(/* @__PURE__ */ React.createElement(Row, { key: a.id, title: a.email ?? a.id.slice(0, 8), desc: state || void 0, controls }));
    }
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "add", title: "Add another account", controls: /* @__PURE__ */ React.createElement(Button, { onClick: startLogin, disabled: busy }, busy ? "Opening browser\u2026" : "Sign in") }));
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "all", title: "Manage", controls: /* @__PURE__ */ React.createElement(Button, { onClick: showQuota, disabled: quotaLoading }, quotaLoading ? "Loading\u2026" : "Show quota") }));
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "disconnect", title: "Disconnect", controls: /* @__PURE__ */ React.createElement(Button, { danger: true, onClick: () => logout(void 0) }, "Disconnect all") }));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "agy-page" }, /* @__PURE__ */ React.createElement("div", { className: "agy-list" }, rows), error ? /* @__PURE__ */ React.createElement("p", { className: "agy-error", role: "alert" }, error) : null, quota ? /* @__PURE__ */ React.createElement("pre", { className: "agy-quota" }, quota) : null, /* @__PURE__ */ React.createElement("p", { className: "agy-note" }, "Tokens and account data are stored only on this device, under your Harness home directory."));
}
function BundleConfig(props) {
  if (props.view === "summary") return /* @__PURE__ */ React.createElement("span", null, "Sign in with Google to use Antigravity models.");
  return /* @__PURE__ */ React.createElement(AntigravityPage, null);
}
var inject = ["slots"];
async function apply(ctx) {
  installStyles();
  let slots = ctx.slots ?? ctx.get?.("slots");
  for (let i = 0; slots === void 0 && i < 60; i++) {
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    slots = ctx.slots ?? ctx.get?.("slots");
  }
  if (slots === void 0) {
    console.warn("[dsh-agy] slots service not ready; settings page not registered");
    return;
  }
  const dispose = slots.inject(
    "plugins.bundle.config",
    () => slots.register(
      { name: "plugins.bundle.config", key: "dsh-agy", label: () => "Google Antigravity" },
      BundleConfig
    )
  );
  ctx.effect?.(() => () => {
    if (dispose) dispose();
  }, "dsh-agy: settings slot");
}

return module.exports;
} });
