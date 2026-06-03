// Chat UI at chat.ssp.mightybee.dev. Requires a Cognito session cookie set by
// /chat/login. Bedrock calls go through the platform's meteredBedrockInvoke,
// so every message lands in llm_calls (per-tenant accounting) and emits a
// trace span via the MCP-shared observability layer.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ChatBox } from "@/components/chat-box";

export const dynamic = "force-dynamic";

function parseJwt(jwt: string): Record<string, unknown> | null {
  try {
    const [, payload] = jwt.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

export default async function ChatPage() {
  const c = await cookies();
  const idToken = c.get("ssp_chat_id_token")?.value;
  if (!idToken) redirect("/chat/login");

  const claims = parseJwt(idToken);
  const sub = (claims?.sub as string) ?? "unknown";
  const email = (claims?.email as string) ?? "(no email)";

  return (
    <section className="max-w-2xl mx-auto py-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl">SSP Chat</h1>
        <form action={async () => {
          "use server";
          const cookies_ = await cookies();
          cookies_.delete("ssp_chat_id_token");
          redirect("/chat/login");
        }}>
          <button type="submit" className="text-xs text-muted">
            sign out ({email})
          </button>
        </form>
      </header>
      <p className="text-muted text-sm">
        Every message routes through Bedrock Claude Haiku 4.5 via the
        platform&apos;s metered invoke wrapper. Spend counts against the tenant&apos;s
        monthly cap — when the cap is hit, sends return a guarded-action
        refusal instead of a Bedrock call.
      </p>
      <ChatBox userSub={sub} />
    </section>
  );
}
