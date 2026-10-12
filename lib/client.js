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
var MUTATING = /* @__PURE__ */ new Set(["login", "logout", "activate", "cancel-login", "refresh-models", "update/check", "update/install", "update/config"]);
async function rpc(method, args, signal) {
  const query = !MUTATING.has(method) && args ? `?${new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]))}` : "";
  const url = `${PREFIX}/${method}${query}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), method.startsWith("update/") ? 15e4 : method === "quota" ? 6e4 : 15e3);
  const mutating = MUTATING.has(method);
  try {
    const response = await fetch(url, {
      method: mutating ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: mutating ? JSON.stringify(args ?? {}) : void 0,
      signal: controller.signal,
      cache: "no-store"
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
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
  const [activity, setActivity] = React.useState("");
  const [authorizationUrl, setAuthorizationUrl] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [actionBusy, setActionBusy] = React.useState(false);
  const loginRef = React.useRef(null);
  const loginIdRef = React.useRef(null);
  const popupRef = React.useRef(null);
  const lifetimeRef = React.useRef(null);
  const loadingRef = React.useRef(false);
  const activeRef = React.useRef(true);
  const load = React.useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const body = await rpc("status", void 0, lifetimeRef.current?.signal);
      if (activeRef.current) setAccounts(body.accounts);
    } catch {
      if (activeRef.current) setError("No se pudo conectar con Harness. Comprueba la conexi\xF3n y vuelve a intentarlo.");
    } finally {
      loadingRef.current = false;
    }
  }, []);
  React.useEffect(() => {
    activeRef.current = true;
    lifetimeRef.current = new AbortController();
    load();
    const timer = window.setInterval(load, 5e3);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      lifetimeRef.current?.abort();
      loginRef.current?.abort();
      popupRef.current?.close();
    };
  }, [load]);
  const startLogin = React.useCallback(async () => {
    if (loginRef.current) return;
    const controller = new AbortController();
    loginRef.current = controller;
    let popup = null;
    try {
      popup = window.open("about:blank", "_blank", "popup,width=600,height=760");
      if (popup) {
        popup.opener = null;
        popup.document.title = "Conectando con Google\u2026";
      }
    } catch {
      popup?.close();
      popup = null;
    }
    popupRef.current = popup;
    setBusy(true);
    setError("");
    setNotice("Preparando la conexi\xF3n con Google\u2026");
    setAuthorizationUrl("");
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 5 * 60 * 1e3);
    try {
      const res = await rpc("login", void 0, controller.signal);
      loginIdRef.current = res.loginId;
      if (controller.signal.aborted) return;
      const url = new URL(res.authorizationUrl);
      if (!res.loginId || url.protocol !== "https:") throw new Error("El servidor devolvi\xF3 una autorizaci\xF3n no v\xE1lida.");
      setAuthorizationUrl(url.href);
      setNotice("Completa la autorizaci\xF3n en Google. Si no se abri\xF3 la ventana, utiliza el enlace siguiente.");
      if (popup && !popup.closed) {
        try {
          popup.location.replace(url.href);
        } catch {
        }
      }
      let failures = 0;
      while (!controller.signal.aborted) {
        let status;
        try {
          status = await rpc("poll", { loginId: res.loginId }, controller.signal);
          failures = 0;
        } catch (error2) {
          if (controller.signal.aborted) break;
          if (++failures >= 4) throw error2;
          setNotice("Conexi\xF3n interrumpida; reintentando comprobar la autorizaci\xF3n\u2026");
          status = { kind: "pending" };
        }
        if (controller.signal.aborted) break;
        if (status.kind === "succeeded") {
          setNotice(status.email ? `Cuenta conectada: ${status.email}` : "Cuenta conectada correctamente.");
          setQuota("");
          await load();
          return;
        }
        if (status.kind === "failed") throw new Error(status.message);
        if (status.kind === "cancelled") throw new Error("La autorizaci\xF3n se ha cancelado.");
        if (status.kind !== "pending") throw new Error("Respuesta de autorizaci\xF3n no v\xE1lida.");
        await new Promise((resolve) => {
          const finish = () => {
            window.clearTimeout(timer);
            controller.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = window.setTimeout(finish, 2e3);
          controller.signal.addEventListener("abort", finish, { once: true });
        });
      }
    } catch (error2) {
      if (activeRef.current && !controller.signal.aborted) {
        setNotice("");
        setError(error2 instanceof Error ? error2.message : "No se pudo conectar con Google.");
      }
    } finally {
      window.clearTimeout(deadline);
      if (controller.signal.aborted && loginIdRef.current) {
        void rpc("cancel-login", { loginId: loginIdRef.current }).catch(() => void 0);
      }
      popup?.close();
      if (loginRef.current === controller) {
        loginRef.current = null;
        loginIdRef.current = null;
        popupRef.current = null;
        if (activeRef.current) {
          setBusy(false);
          setAuthorizationUrl("");
          if (controller.signal.aborted) setNotice(timedOut ? "La autorizaci\xF3n agot\xF3 el plazo de cinco minutos. Vuelve a conectar." : "Autorizaci\xF3n cancelada.");
        }
      }
    }
  }, [load]);
  const logout = React.useCallback((accountId) => {
    if (actionBusy || !window.confirm(accountId ? "\xBFEliminar esta cuenta de Antigravity de este dispositivo?" : "\xBFDesconectar todas las cuentas de Antigravity?")) return;
    setActionBusy(true);
    setError("");
    rpc("logout", accountId ? { accountId } : {}, lifetimeRef.current?.signal).then(() => {
      if (activeRef.current) {
        setQuota("");
        void load();
      }
    }).catch((e) => {
      if (activeRef.current) setError(e.message);
    }).finally(() => {
      if (activeRef.current) setActionBusy(false);
    });
  }, [load, actionBusy]);
  const activate = React.useCallback((accountId) => {
    if (actionBusy) return;
    setActionBusy(true);
    setError("");
    rpc("activate", { accountId }, lifetimeRef.current?.signal).then(() => load()).catch((e) => {
      if (activeRef.current) setError(e.message);
    }).finally(() => {
      if (activeRef.current) setActionBusy(false);
    });
  }, [load, actionBusy]);
  const showQuota = React.useCallback(() => {
    setQuotaLoading(true);
    setError("");
    rpc("quota", void 0, lifetimeRef.current?.signal).then((b) => {
      if (activeRef.current) setQuota(b.report || "No hay informaci\xF3n de cuotas disponible.");
    }).catch((e) => {
      if (activeRef.current) setError(e.message);
    }).finally(() => {
      if (activeRef.current) setQuotaLoading(false);
    });
  }, []);
  const showStats = React.useCallback(() => {
    rpc("stats", void 0, lifetimeRef.current?.signal).then((result) => {
      if (activeRef.current) setActivity([
        result.accounts.map((entry) => `${entry.accountId.slice(0, 8)}: ${entry.success} completadas \xB7 ${entry.rateLimits} l\xEDmites \xB7 ${entry.errors} errores`).join("\n") || "Sin actividad en esta instancia.",
        result.lastDiagnostic ? `\xDAltimo fallo: ${result.lastDiagnostic.model} \xB7 ${result.lastDiagnostic.kind} \xB7 finishReason=${result.lastDiagnostic.finishReason ?? "missing"}` : ""
      ].filter(Boolean).join("\n"));
    }).catch((error2) => {
      if (activeRef.current) setError(error2.message);
    });
  }, []);
  const refreshModels = React.useCallback(() => {
    rpc("refresh-models", {}, lifetimeRef.current?.signal).then(() => {
      if (activeRef.current) setNotice("Actualizaci\xF3n de modelos solicitada. Comprueba el selector de modelos.");
    }).catch((error2) => {
      if (activeRef.current) setError(error2.message);
    });
  }, []);
  if (accounts === null) {
    return /* @__PURE__ */ React.createElement("div", { className: "agy-page" }, /* @__PURE__ */ React.createElement("p", { className: "agy-note" }, "Cargando cuentas\u2026"), error ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "agy-error", role: "alert" }, error), /* @__PURE__ */ React.createElement(Button, { onClick: () => {
      setError("");
      void load();
    } }, "Reintentar")) : null);
  }
  const rows = [];
  if (accounts.length === 0) {
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "empty", title: "Sin cuentas conectadas", desc: "Conecta tu cuenta de Google para utilizar los modelos disponibles en tu plan de Antigravity.", controls: /* @__PURE__ */ React.createElement(Button, { onClick: startLogin, disabled: busy }, busy ? "Esperando autorizaci\xF3n\u2026" : "Conectar con Google") }));
  } else {
    for (const a of accounts) {
      const pill = a.active ? /* @__PURE__ */ React.createElement("span", { className: "agy-pill agy-pill--ok" }, "Activa") : null;
      const controls = /* @__PURE__ */ React.createElement(React.Fragment, null, pill, !a.active ? /* @__PURE__ */ React.createElement(Button, { onClick: () => activate(a.id), disabled: actionBusy || busy || !a.enabled }, "Activar") : null, /* @__PURE__ */ React.createElement(Button, { danger: true, onClick: () => logout(a.id), disabled: actionBusy || busy }, "Eliminar"));
      const state = [a.enabled ? "Habilitada" : "Deshabilitada", a.rateLimited ? "L\xEDmite de uso alcanzado" : null, a.coolingDown ? "En espera de recuperaci\xF3n" : null].filter(Boolean).join(" \xB7 ");
      rows.push(/* @__PURE__ */ React.createElement(Row, { key: a.id, title: a.email ?? a.id.slice(0, 8), desc: state || void 0, controls }));
    }
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "add", title: "A\xF1adir otra cuenta", controls: /* @__PURE__ */ React.createElement(Button, { onClick: startLogin, disabled: busy || actionBusy }, busy ? "Esperando autorizaci\xF3n\u2026" : "Conectar con Google") }));
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "all", title: "Cuotas de las cuentas", desc: "Consulta las ventanas de uso y la disponibilidad informadas por Antigravity.", controls: /* @__PURE__ */ React.createElement(Button, { onClick: showQuota, disabled: quotaLoading || actionBusy }, quotaLoading ? "Consultando\u2026" : "Consultar cuotas") }));
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "models", title: "Modelos disponibles", controls: /* @__PURE__ */ React.createElement(Button, { onClick: refreshModels, disabled: busy || actionBusy }, "Actualizar modelos") }));
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "stats", title: "Actividad de esta instancia", controls: /* @__PURE__ */ React.createElement(Button, { onClick: showStats }, "Consultar actividad") }));
    rows.push(/* @__PURE__ */ React.createElement(Row, { key: "disconnect", title: "Desconectar", controls: /* @__PURE__ */ React.createElement(Button, { danger: true, onClick: () => logout(void 0), disabled: actionBusy || busy }, "Desconectar todas") }));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "agy-page" }, /* @__PURE__ */ React.createElement("div", { className: "agy-list" }, rows), notice ? /* @__PURE__ */ React.createElement("p", { className: "agy-note", role: "status" }, notice) : null, authorizationUrl ? /* @__PURE__ */ React.createElement("p", { className: "agy-note" }, /* @__PURE__ */ React.createElement("a", { href: authorizationUrl, target: "_blank", rel: "noopener noreferrer" }, "Abrir autorizaci\xF3n de Google")) : null, busy ? /* @__PURE__ */ React.createElement(Button, { onClick: () => loginRef.current?.abort() }, "Cancelar autorizaci\xF3n") : null, error ? /* @__PURE__ */ React.createElement("p", { className: "agy-error", role: "alert" }, error) : null, quota ? /* @__PURE__ */ React.createElement("pre", { className: "agy-quota" }, quota) : null, activity ? /* @__PURE__ */ React.createElement("pre", { className: "agy-quota" }, activity) : null, /* @__PURE__ */ React.createElement("p", { className: "agy-note" }, "Los tokens y los datos de las cuentas se guardan en el dispositivo donde se ejecuta Harness. Si accedes de forma remota, la autorizaci\xF3n debe completarse en un navegador de ese dispositivo."));
}
function PackageUpdates() {
  const [state, setState] = React.useState(null);
  const [origin, setOrigin] = React.useState("");
  const [minutes, setMinutes] = React.useState("360");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const lifetime = React.useRef(null);
  React.useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    rpc("update/status", void 0, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setState(result);
        setOrigin(result.registryOrigin);
        setMinutes(String(result.intervalMs / 6e4));
      }
    }).catch((error2) => {
      if (!controller.signal.aborted) setError(error2.message);
    });
    return () => controller.abort();
  }, []);
  const action = (method, body = {}) => {
    if (busy) return;
    setBusy(true);
    setError("");
    rpc(method, body, lifetime.current?.signal).then((result) => {
      if (!lifetime.current?.signal.aborted) setState(result);
    }).catch((error2) => {
      if (!lifetime.current?.signal.aborted) setError(error2.message);
    }).finally(() => {
      if (!lifetime.current?.signal.aborted) setBusy(false);
    });
  };
  return /* @__PURE__ */ React.createElement("div", { className: "agy-page" }, /* @__PURE__ */ React.createElement(Row, { title: "Actualizaci\xF3n del plugin", desc: state ? `En ejecuci\xF3n: ${state.runningVersion} \xB7 Disco: ${state.diskVersion}${state.latest ? ` \xB7 \xDAltima versi\xF3n: ${state.latest}` : ""}` : "Consultando versi\xF3n\u2026", controls: /* @__PURE__ */ React.createElement(Button, { disabled: busy || !state?.configured, onClick: () => action("update/check") }, "Comprobar actualizaci\xF3n") }), state ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "agy-note" }, !state.configured ? "Origen no configurado. No se descargar\xE1 ning\xFAn paquete hasta que confirmes un registro npm HTTPS de confianza que publique dsh-agy." : state.pendingRestart ? "La versi\xF3n del disco cambi\xF3. Reinicia Harness para aplicarla." : state.available ? "Hay una versi\xF3n nueva disponible." : state.lastCheckAt ? "No hay una versi\xF3n m\xE1s reciente disponible." : "A\xFAn no se ha comprobado el origen."), !state.installAllowed ? /* @__PURE__ */ React.createElement("p", { className: "agy-note" }, "La instalaci\xF3n autom\xE1tica solo est\xE1 permitida dentro de profiles de DSH; no se modifica una copia de desarrollo.") : null, /* @__PURE__ */ React.createElement(Row, { title: "Modo de actualizaci\xF3n", desc: "Autom\xE1tico comprueba e instala en el intervalo elegido. Al abrir esta p\xE1gina se pausa la instalaci\xF3n autom\xE1tica hasta reiniciar Harness.", controls: /* @__PURE__ */ React.createElement(Button, { disabled: busy, onClick: () => action("update/config", { enabled: !state.enabled }) }, state.enabled ? "Desactivar autom\xE1tico" : "Activar autom\xE1tico") }), /* @__PURE__ */ React.createElement(Row, { title: "Origen e intervalo", controls: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { "aria-label": "Registro npm HTTPS de confianza", placeholder: "https://registro-de-confianza", value: origin, onChange: (event) => setOrigin(event.target.value), disabled: busy }), /* @__PURE__ */ React.createElement("input", { "aria-label": "Intervalo en minutos", type: "number", min: "1", max: "10080", value: minutes, onChange: (event) => setMinutes(event.target.value), disabled: busy }), /* @__PURE__ */ React.createElement(Button, { disabled: busy, onClick: () => {
    if (origin !== state.registryOrigin && origin && !window.confirm(`\xBFConf\xEDas en ${origin} para descargar y ejecutar versiones de dsh-agy?`)) return;
    action("update/config", { registryOrigin: origin, intervalMs: Number(minutes) * 6e4 });
  } }, "Guardar")) }), state.available ? /* @__PURE__ */ React.createElement(Button, { disabled: busy || !state.installAllowed || state.pendingRestart, onClick: () => {
    if (window.confirm(`\xBFInstalar dsh-agy ${state.latest}? Se guardar\xE1 una copia de seguridad. Ser\xE1 necesario reiniciar Harness.`)) action("update/install", { confirm: true });
  } }, "Instalar ", state.latest) : null, state.lastError ? /* @__PURE__ */ React.createElement("p", { className: "agy-error", role: "alert" }, "Actualizaci\xF3n no realizada: ", state.lastError, ". Se conserva la versi\xF3n anterior; revisa el origen o instala manualmente.") : null) : null, busy ? /* @__PURE__ */ React.createElement("p", { className: "agy-note", role: "status" }, "Procesando actualizaci\xF3n\u2026") : null, error ? /* @__PURE__ */ React.createElement("p", { className: "agy-error", role: "alert" }, error) : null);
}
function BundleConfig(props) {
  if (props.view === "summary") return /* @__PURE__ */ React.createElement("span", null, "Conecta tu cuenta de Google para utilizar los modelos de Antigravity.");
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(AntigravityPage, null), /* @__PURE__ */ React.createElement(PackageUpdates, null));
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
