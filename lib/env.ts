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
    ANTHROPIC_API_KEY: z.string(),
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
    if (!env.REQUIRE_SIGN_IN) return;
    for (const key of SIGN_IN_KEYS) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: "missing (required when REQUIRE_SIGN_IN=true)" });
      }
    }
  });

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
