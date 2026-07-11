const EXTERNAL_PROTOCOLS = new Set(["https:", "mailto:", "tel:"]);

export function normalizeFirstPartyOrigins(values) {
  const origins = new Set();
  for (const value of values) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && url.origin === value.replace(/\/$/, "") && url.pathname === "/") {
        origins.add(url.origin);
      }
    } catch {
      // Invalid configuration is ignored here and rejected by config validation.
    }
  }
  return origins;
}

export function classifyNavigation(rawUrl, firstPartyOrigins) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "blocked";
  }
  if (url.protocol === "https:") {
    return normalizeFirstPartyOrigins(firstPartyOrigins).has(url.origin) ? "internal" : "external";
  }
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? "external" : "blocked";
}

export async function openExternalNavigation(rawUrl, options = {}) {
  if (classifyNavigation(rawUrl, options.firstPartyOrigins ?? []) !== "external") {
    throw unsupported("Navigation is not an external allowlisted protocol");
  }

  if (options.browser?.open) {
    await options.browser.open({ url: rawUrl });
    return { opened: "system" };
  }

  const openWindow = options.openWindow ?? globalThis.window?.open?.bind(globalThis.window);
  if (!openWindow) throw unsupported("System browser is unavailable");
  const opened = openWindow(rawUrl, "_blank", "noopener,noreferrer");
  if (opened === null) throw unsupported("System browser blocked the navigation");
  return { opened: "browser" };
}

export function installNavigationGuard({ document, firstPartyOrigins, openExternal }) {
  const onClick = (event) => {
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor) return;
    const decision = classifyNavigation(anchor.href, firstPartyOrigins);
    if (decision === "internal") return;
    event.preventDefault();
    if (decision === "external") {
      void openExternal(anchor.href).catch(() => {
        document.dispatchEvent(new CustomEvent("silsigan:navigation-error", {
          detail: { code: "EXTERNAL_OPEN_FAILED" },
        }));
      });
    }
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

function unsupported(message) {
  return Object.assign(new Error(message), { code: "UNSUPPORTED" });
}
