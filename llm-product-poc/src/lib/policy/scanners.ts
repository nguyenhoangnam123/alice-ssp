// Free-text scanners run by the policy gate against the CR description.
//
// All findings are redacted before they enter status_history / logs — we
// don't store the raw value of PII or injection attempts. The audit value is
// "they tried", not "what they tried with."
//
// These are intentionally cheap. Sophisticated prompt injection and full PII
// coverage need layers 2 (Bedrock Guardrails) and B (AWS Comprehend), which
// are documented in deliverable1-03 as Ring 2. The patterns here catch the
// obvious cases before we burn Bedrock tokens.

export type ScanFinding = {
  /** Stable identifier for the rule that fired. */
  rule: string;
  /** Human-readable explanation safe to surface to the operator. */
  message: string;
};

const INJECTION_RULES: Array<{ rule: string; pattern: RegExp; message: string }> = [
  {
    rule: "injection.ignore_previous",
    pattern: /\b(ignore|disregard|forget)\b[\s\S]{0,40}\b(previous|prior|above|earlier|system)\b[\s\S]{0,40}\b(instructions?|rules?|prompt)\b/i,
    message: "description contains an 'ignore previous instructions'-style instruction-override pattern",
  },
  {
    rule: "injection.system_role_impersonation",
    pattern: /^\s*(\[INST\]|<\|im_start\|>|<\|start_header_id\|>|system\s*:\s*you\s+are)/im,
    message: "description begins with a chat-template control token or 'system:' role marker",
  },
  {
    rule: "injection.fence_takeover",
    pattern: /```\s*(reject|helm|argocd|dockerfile|ci)\s*\n/i,
    message: "description contains a fenced block matching one of the AI's artifact tags — would short-circuit the parser",
  },
  {
    rule: "injection.new_system_prompt",
    pattern: /\b(you\s+are\s+now|new\s+(system\s+)?prompt|begin\s+system|end\s+system)\b/i,
    message: "description attempts to redefine the model's role",
  },
];

export function scanInjection(text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const r of INJECTION_RULES) {
    if (r.pattern.test(text)) {
      findings.push({ rule: r.rule, message: r.message });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// PII regex pre-filter (layer A in deliverable1-03). Cheap; kills the obvious.
// Layer B (Comprehend) is the authoritative scan once we've decided to pay
// for it per call.
//
// Matches are REDACTED in the finding message — we never persist raw PII even
// in the rejection record. The redaction shape preserves the type so security
// can audit "what categories did people try to submit" without seeing the
// values.
// ---------------------------------------------------------------------------

const PII_PATTERNS: Array<{ rule: string; pattern: RegExp; redact: (match: string) => string }> = [
  {
    rule: "pii.email",
    pattern: /\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b/g,
    redact: () => "EMAIL ********@*****.***",
  },
  {
    rule: "pii.aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    redact: () => "AWS_ACCESS_KEY AKIA****************",
  },
  {
    rule: "pii.jwt",
    pattern: /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    redact: () => "JWT ey***.***.***",
  },
  {
    rule: "pii.ssn_us",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    redact: () => "SSN_US ***-**-****",
  },
  {
    rule: "pii.ipv4",
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    redact: () => "IP_ADDRESS ***.***.***.***",
  },
  {
    // Credit card: 13-19 digits possibly grouped by spaces/dashes. We run a
    // Luhn check below to suppress false positives like "1234 5678 9012 3456".
    rule: "pii.credit_card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    redact: () => "CREDIT_CARD ****-****-****-****",
  },
];

function luhn(raw: string): boolean {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function scanPii(text: string): ScanFinding[] {
  const found = new Set<string>();
  const findings: ScanFinding[] = [];
  for (const p of PII_PATTERNS) {
    const matches = text.match(p.pattern);
    if (!matches) continue;
    for (const m of matches) {
      if (p.rule === "pii.credit_card" && !luhn(m)) continue;
      const key = `${p.rule}:${m}`;
      if (found.has(key)) continue;
      found.add(key);
      findings.push({ rule: p.rule, message: `contains ${p.redact(m)}` });
    }
  }
  return findings;
}
