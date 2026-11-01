import { connection } from "next/server";
import { auth } from "@/auth";
import { signOutAction } from "./auth-actions";

// Reads the session cookie, so the layout renders it inside <Suspense>.
// Signing in starts from the comparison that needs it (blocked-panel.tsx).
export async function Account() {
  await connection(); // auth() uses crypto before it reads the cookie: keep it out of the prerender
  const email = (await auth())?.user?.email;
  if (!email) return null;
  return (
    <form action={signOutAction}>
      <button type="submit" title={`Signed in as ${email}`} className="text-sm text-muted transition-colors hover:text-ink">
        Sign out
      </button>
    </form>
  );
}
