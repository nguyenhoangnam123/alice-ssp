import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/rbac";
import { ZodError } from "zod";

export function handleApiError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "validation_failed", issues: err.issues }, { status: 400 });
  }
  if (err instanceof Error) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ error: "unknown" }, { status: 500 });
}
