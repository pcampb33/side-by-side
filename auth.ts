import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Google sign-in with the basic scopes (email, profile), sessions in a signed
// cookie. Used only when REQUIRE_SIGN_IN=true; reads AUTH_SECRET,
// AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.
export const { handlers, auth, signIn, signOut } = NextAuth({ providers: [Google] });
