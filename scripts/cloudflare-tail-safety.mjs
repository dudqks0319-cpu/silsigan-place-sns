const SENSITIVE_TAIL_PATTERNS = [
  { label: "cloudflare_or_openai_token", regex: /\b(?:sk|sk-proj|cf)_[A-Za-z0-9_-]{16,}\b|\bsk-[A-Za-z0-9_-]{16,}\b/gi },
  { label: "assigned_secret", regex: /\b(?:ADMIN_TOKEN|ADMIN_TOKENS|CLOUDFLARE_API_TOKEN)\b\s*[:=]\s*["']?(?!\[redacted\]|redacted)[^"'\s]{6,}/gi },
  { label: "admin_token_header", regex: /\bx-silsigan-admin-token\b["']?\s*[:=]\s*["']?(?!\[redacted\]|redacted)[A-Za-z0-9._~+/=-]{8,}/gi },
  { label: "bearer_token", regex: /\bBearer\s+(?!\[redacted\]|redacted)[A-Za-z0-9._~+/=-]{16,}/gi },
  { label: "anonymous_session_proof", regex: /(?:\bx-silsigan-anon-proof\b|\bproof\b)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?(?!\[redacted\]|redacted)[A-Za-z0-9_-]{43}\b/gi },
  { label: "anonymous_id", regex: /\banon_[A-Za-z0-9_-]{8,}\b/gi },
  { label: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { label: "raw_latitude", regex: /\b(?:latitude|lat)\b["']?\s*[:=]\s*"?-?\d{1,2}\.\d{4,}/gi },
  { label: "raw_longitude", regex: /\b(?:longitude|lng)\b["']?\s*[:=]\s*"?-?\d{2,3}\.\d{4,}/gi },
  { label: "coordinate_pair_lat_lng", regex: /\b(?:3[3-9]|4[0-3])\.\d{4,}\s*,\s*(?:12[4-9]|13[0-2])\.\d{4,}\b/g },
  { label: "coordinate_pair_lng_lat", regex: /\b(?:12[4-9]|13[0-2])\.\d{4,}\s*,\s*(?:3[3-9]|4[0-3])\.\d{4,}\b/g },
  { label: "original_filename", regex: /\b[A-Za-z0-9][A-Za-z0-9_. -]{2,}\.(?:jpe?g|png|webp|heic|gif)\b/gi },
  { label: "r2_object_key", regex: /\b(?:photos\/_uploads\/[A-Za-z0-9._~/-]{8,}|photos\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/\d{4}\/\d{2}\/[A-Za-z0-9._~-]{8,})\b/gi },
];

export function findSensitiveTailLogFindings(text) {
  const findings = [];
  for (const pattern of SENSITIVE_TAIL_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) {
      findings.push(pattern.label);
    }
  }
  return findings;
}

export function parseWranglerTailEvents(text) {
  const events = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (depth === 0) {
      if (/\s/.test(character)) {
        continue;
      }
      if (character !== "{") {
        throw new Error("Wrangler tail output contains non-JSON data.");
      }
      objectStart = index;
      depth = 1;
      inString = false;
      escaped = false;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const parsed = JSON.parse(text.slice(objectStart, index + 1));
        if (!isRecord(parsed)) {
          throw new Error("Wrangler tail event must be a JSON object.");
        }
        events.push(parsed);
        objectStart = -1;
      }
    }
  }

  if (depth !== 0 || objectStart !== -1 || inString) {
    throw new Error("Wrangler tail output ended with an incomplete JSON event.");
  }

  return events;
}

export function sanitizeWranglerTailText(text) {
  const events = parseWranglerTailEvents(text);
  return events.map((event) => JSON.stringify(sanitizeWranglerTailEvent(event))).join("\n") + (events.length > 0 ? "\n" : "");
}

export function sanitizeWranglerTailEvent(event) {
  const sanitized = structuredClone(event);
  const invocation = isRecord(sanitized.event) ? sanitized.event : null;
  const request = invocation && isRecord(invocation.request) ? invocation.request : null;
  const response = invocation && isRecord(invocation.response) ? invocation.response : null;

  if (request) {
    if ("url" in request) {
      request.url = sanitizeRequestUrl(request.url);
    }
    if ("headers" in request) {
      request.headers = "[redacted]";
    }
    if ("cf" in request) {
      request.cf = "[redacted]";
    }
  }

  if (response && "headers" in response) {
    response.headers = "[redacted]";
  }

  return sanitized;
}

function sanitizeRequestUrl(value) {
  if (typeof value !== "string") {
    return "[redacted]";
  }

  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.origin}/[redacted]`;
  } catch {
    return "[redacted]";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
