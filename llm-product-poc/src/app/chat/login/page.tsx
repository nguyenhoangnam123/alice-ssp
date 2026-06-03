// Username/password sign-in for chat.ssp.mightybee.dev. Submits to the
// /api/chat/login route which does Cognito InitiateAuth USER_PASSWORD_AUTH.
// On success the route sets an httpOnly cookie and the browser is redirected
// to /chat.
import { redirect } from "next/navigation";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";

function secretHash(username: string, clientId: string, clientSecret: string) {
  // Cognito's required SECRET_HASH when the app client has a client secret.
  // HMAC-SHA256(username + client_id) base64-encoded. Computed server-side
  // so the secret never crosses the wire.
  return createHmac("sha256", clientSecret)
    .update(username + clientId)
    .digest("base64");
}

async function signIn(formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    redirect("/chat/login?error=missing");
  }

  const client = new CognitoIdentityProviderClient({
    region: process.env.COGNITO_REGION ?? "eu-west-1",
  });
  const clientId = process.env.COGNITO_CLIENT_ID!;
  const clientSecret = process.env.COGNITO_CLIENT_SECRET;
  const authParams: Record<string, string> = {
    USERNAME: username,
    PASSWORD: password,
  };
  if (clientSecret) {
    authParams.SECRET_HASH = secretHash(username, clientId, clientSecret);
  }
  try {
    const res = await client.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: authParams,
      }),
    );
    const id = res.AuthenticationResult?.IdToken;
    if (!id) {
      // CHALLENGE_NAME would be set if MFA / NEW_PASSWORD_REQUIRED. We don't
      // handle those flows in the demo; the user we provisioned has its
      // password already set permanent so this path shouldn't fire.
      redirect("/chat/login?error=challenge");
    }
    const c = await cookies();
    c.set("ssp_chat_id_token", id!, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      // The id_token from Cognito has its own exp; cap our cookie at 8h
      // regardless so a forgotten browser session doesn't linger forever.
      maxAge: 60 * 60 * 8,
      path: "/",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Bubble the Cognito error code so the UI can show "wrong password"
    // distinctly from "user not found" etc.
    const code = (err as { name?: string })?.name ?? "AuthError";
    redirect(`/chat/login?error=${encodeURIComponent(code)}&detail=${encodeURIComponent(msg.slice(0, 200))}`);
  }
  redirect("/chat");
}

export default async function ChatLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const { error, detail } = await searchParams;
  return (
    <section className="max-w-md mx-auto py-10">
      <h1 className="text-xl mb-4">Sign in to chat</h1>
      <form action={signIn} className="space-y-4 border border-border rounded p-6">
        <div>
          <label className="block text-sm text-muted mb-1">email</label>
          <input
            name="username"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="username"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">password</label>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {error && (
          <p className="text-sm text-red-400">
            {error}: {detail}
          </p>
        )}
        <button type="submit">Sign in</button>
      </form>
    </section>
  );
}
