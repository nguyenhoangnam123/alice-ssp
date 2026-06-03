// In-process span tracking. The trace ID is conventionally the CR ID — every
// span emitted for the work of one ChangeRequest carries the same trace_id, so
// a single CloudWatch Logs Insights filter on trace_id=<cr_id> returns the
// whole tool-call chain.

import { emitSpan, type LiveSpan, type SpanStatus } from "./emit";

const liveSpans = new Map<string, LiveSpan>();

function ulid(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 12)
  ).toUpperCase();
}

export function startSpan(args: {
  traceId: string;
  name: string;
  parentSpanId?: string;
  attributes?: Record<string, string | number | boolean>;
}): string {
  const spanId = ulid();
  liveSpans.set(spanId, {
    spanId,
    parentSpanId: args.parentSpanId,
    traceId: args.traceId,
    name: args.name,
    startedAtMs: Date.now(),
    attributes: args.attributes ?? {},
  });
  return spanId;
}

export function endSpan(
  spanId: string,
  status: SpanStatus = "ok",
  attributes?: Record<string, string | number | boolean>,
): void {
  const span = liveSpans.get(spanId);
  if (!span) {
    // Span unknown — never happens in normal flow but never throw from obs.
    return;
  }
  liveSpans.delete(spanId);
  emitSpan(span, status, attributes);
}

/**
 * Run an async function inside a span. Auto-ends the span on success, or as
 * status='error' with the error message on failure (then re-throws).
 */
export async function withSpan<T>(
  args: {
    traceId: string;
    name: string;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  },
  fn: (spanId: string) => Promise<T>,
): Promise<T> {
  const spanId = startSpan(args);
  try {
    const out = await fn(spanId);
    endSpan(spanId, "ok");
    return out;
  } catch (err) {
    endSpan(spanId, "error", {
      error_message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
