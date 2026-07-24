"use client";

export type PhotoUploadProtection = {
  turnstileRequired: boolean;
  turnstileSiteKey: string | null;
  turnstileConfigured: boolean;
};

type TurnstileWidgetId = string;

type TurnstileRenderOptions = {
  sitekey: string;
  action: "photo_upload";
  appearance: "interaction-only";
  execution: "execute";
  language: "ko";
  theme: "auto";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => TurnstileWidgetId;
  execute: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

const turnstileScriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const turnstileScriptLoadTimeoutMs = 10_000;
const turnstileTokenMaxLength = 2_048;
let turnstileApiPromise: Promise<TurnstileApi> | null = null;

export async function acquirePhotoUploadTurnstileToken(protection: PhotoUploadProtection): Promise<string | null> {
  if (!protection.turnstileRequired) {
    return null;
  }

  if (!protection.turnstileConfigured) {
    throw new Error("사진 업로드 보안 확인 설정이 완료되지 않았습니다.");
  }

  const siteKey = normalizedSiteKey(protection.turnstileSiteKey);
  if (!siteKey) {
    throw new Error("사진 업로드 보안 확인 설정이 완료되지 않았습니다.");
  }

  const api = await loadTurnstileApi();
  return executeTurnstileChallenge(api, siteKey);
}

function normalizedSiteKey(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 3 && normalized.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null;
}

function loadTurnstileApi(): Promise<TurnstileApi> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("이 환경에서는 사진 업로드 보안 확인을 실행할 수 없습니다."));
  }

  const current = (window as TurnstileWindow).turnstile;
  if (current) {
    return Promise.resolve(current);
  }
  if (turnstileApiPromise) {
    return turnstileApiPromise;
  }

  turnstileApiPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-silsigan-turnstile="true"]');
    const script = existing ?? document.createElement("script");
    let settled = false;
    const timeout = window.setTimeout(() => finishWithError(), turnstileScriptLoadTimeoutMs);

    const cleanupListeners = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", finishFromWindow);
      script.removeEventListener("error", finishWithError);
    };
    const finishFromWindow = () => {
      if (settled) return;
      const api = (window as TurnstileWindow).turnstile;
      if (!api) {
        finishWithError();
        return;
      }
      settled = true;
      cleanupListeners();
      resolve(api);
    };
    const finishWithError = () => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      turnstileApiPromise = null;
      reject(new Error("사진 업로드 보안 확인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
    };

    script.addEventListener("load", finishFromWindow, { once: true });
    script.addEventListener("error", finishWithError, { once: true });
    if (!existing) {
      script.src = turnstileScriptUrl;
      script.async = true;
      script.defer = true;
      script.dataset.silsiganTurnstile = "true";
      document.head.append(script);
    }
  });

  return turnstileApiPromise;
}

function executeTurnstileChallenge(api: TurnstileApi, siteKey: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const { overlay, widget, cancel } = createChallengeOverlay();
    let widgetId: TurnstileWidgetId | null = null;
    let settled = false;

    const finish = (result: { token: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      cancel.removeEventListener("click", cancelChallenge);
      if (widgetId) {
        try {
          api.remove(widgetId);
        } catch {
          // The challenge may already have removed an expired widget.
        }
      }
      overlay.remove();
      if ("token" in result) {
        resolve(result.token);
      } else {
        reject(result.error);
      }
    };
    const failChallenge = () => finish({ error: new Error("보안 확인이 만료되었거나 실패했습니다. 다시 시도해 주세요.") });
    const cancelChallenge = () => finish({ error: new Error("사진 업로드 보안 확인을 취소했습니다.") });
    cancel.addEventListener("click", cancelChallenge, { once: true });

    try {
      widgetId = api.render(widget, {
        sitekey: siteKey,
        action: "photo_upload",
        appearance: "interaction-only",
        execution: "execute",
        language: "ko",
        theme: "auto",
        callback: (token) => {
          const normalized = token.trim();
          if (!normalized || normalized.length > turnstileTokenMaxLength) {
            failChallenge();
            return;
          }
          finish({ token: normalized });
        },
        "error-callback": failChallenge,
        "expired-callback": failChallenge,
        "timeout-callback": failChallenge,
      });
      api.execute(widgetId);
    } catch {
      failChallenge();
    }
  });
}

function createChallengeOverlay(): { overlay: HTMLDivElement; widget: HTMLDivElement; cancel: HTMLButtonElement } {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "silsigan-turnstile-title");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: "rgba(15, 23, 42, 0.55)",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(100%, 360px)",
    borderRadius: "20px",
    padding: "20px",
    background: "#ffffff",
    color: "#0f172a",
    boxShadow: "0 24px 64px rgba(15, 23, 42, 0.24)",
    textAlign: "center",
  });

  const title = document.createElement("strong");
  title.id = "silsigan-turnstile-title";
  title.textContent = "안전한 사진 업로드 확인";
  title.style.display = "block";

  const description = document.createElement("p");
  description.textContent = "자동 대량 업로드를 막기 위해 잠시 보안 확인을 진행합니다.";
  description.style.margin = "8px 0 16px";

  const widget = document.createElement("div");
  widget.setAttribute("aria-label", "Cloudflare Turnstile 보안 확인");
  widget.style.minHeight = "65px";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "취소";
  Object.assign(cancel.style, {
    marginTop: "14px",
    border: "0",
    borderRadius: "999px",
    padding: "10px 18px",
    background: "#e2e8f0",
    color: "#0f172a",
    font: "inherit",
    cursor: "pointer",
  });

  card.append(title, description, widget, cancel);
  overlay.append(card);
  document.body.append(overlay);
  cancel.focus();
  return { overlay, widget, cancel };
}
