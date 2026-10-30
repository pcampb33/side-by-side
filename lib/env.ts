import { z } from "zod";

// SPEC.md §6. Checked once at server start (instrumentation.ts) so a
// misconfigured deploy fails loudly with the variable's name instead of
// failing on the first request that needs it.

// Limits, spend and logs live in Redis, and they only exist when sign-in is on.
const SIGN_IN_KEYS = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

const schema = z
  .object({
    // "login" runs Claude through the local Claude Code login (development
    // only). Explicit rather than "no key set" because a stray user-level
    // ANTHROPIC_API_KEY from another project would otherwise be picked up.
    CLAUDE_AUTH: z.enum(["api", "login"]).default("api"),
    ANTHROPIC_API_KEY: z.string().optional(),
    // The SEC rejects requests whose User-Agent lacks a name and an email.
    SEC_USER_AGENT: z.string().regex(/\S\s+\S+@\S+\.\S+/, "must be '<name> <email>'"),
    REQUIRE_SIGN_IN: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    AUTH_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    OWNER_EMAIL: z.email().optional(),
    MONTHLY_BUDGET_USD: z.coerce.number().positive().default(5),
  })
  .superRefine((env, ctx) => {
    // Half a Redis config would silently fall back to the local file cache.
    if ((env.UPSTASH_REDIS_REST_URL === undefined) !== (env.UPSTASH_REDIS_REST_TOKEN === undefined)) {
      const missing = env.UPSTASH_REDIS_REST_URL === undefined ? "UPSTASH_REDIS_REST_URL" : "UPSTASH_REDIS_REST_TOKEN";
      ctx.addIssue({ code: "custom", path: [missing], message: "missing (the other Upstash variable is set)" });
    }
    if (!env.REQUIRE_SIGN_IN) return;
    if (env.CLAUDE_AUTH === "login") {
      ctx.addIssue({
        code: "custom",
        path: ["CLAUDE_AUTH"],
        message: "login is for local development only; with sign-in on, use ANTHROPIC_API_KEY",
      });
    }
    for (const key of SIGN_IN_KEYS) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: "missing (required when REQUIRE_SIGN_IN=true)" });
      }
    }
  })
  // Runs even when other fields failed, so a fresh setup hears about the key
  // in the same error as everything else. It reads only two fields that parse
  // independently of the rest.
  .superRefine(
    (env, ctx) => {
      if (env.CLAUDE_AUTH === "api" && env.ANTHROPIC_API_KEY === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["ANTHROPIC_API_KEY"],
          message: "missing (or set CLAUDE_AUTH=login to use a local Claude Code login)",
        });
      }
    },
    { when: () => true },
  );

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // `KEY=` in a .env file arrives as "", which means unset, not a value.
  const input = Object.fromEntries(
    Object.keys(schema.shape)
      .map((key) => [key, source[key]?.trim()])
      .filter(([, value]) => value),
  );
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const key = String(issue.path[0]);
    return `  ${key}: ${key in input || issue.code === "custom" ? issue.message : "missing"}`;
  });
  throw new Error(`Invalid environment (see .env.example):\n${problems.join("\n")}`);
}
