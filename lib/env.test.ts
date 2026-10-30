import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const local = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  SEC_USER_AGENT: "company-compare jane@example.com",
};

const deployed = {
  ...local,
  REQUIRE_SIGN_IN: "true",
  AUTH_SECRET: "secret",
  AUTH_GOOGLE_ID: "id",
  AUTH_GOOGLE_SECRET: "google-secret",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
};

function errorOf(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("accepts a local clone's two variables and applies defaults", () => {
    const env = parseEnv(local);
    expect(env.REQUIRE_SIGN_IN).toBe(false);
    expect(env.MONTHLY_BUDGET_USD).toBe(5);
  });

  it("names every missing required variable", () => {
    const message = errorOf({});
    expect(message).toContain("ANTHROPIC_API_KEY: missing");
    expect(message).toContain("SEC_USER_AGENT: missing");
  });

  it("treats a blank value as missing", () => {
    expect(errorOf({ ...local, ANTHROPIC_API_KEY: "  " })).toContain("ANTHROPIC_API_KEY: missing");
  });

  it("rejects a User-Agent without an email", () => {
    expect(errorOf({ ...local, SEC_USER_AGENT: "company-compare" })).toContain("SEC_USER_AGENT: must be");
  });

  it("requires auth and Redis when sign-in is on", () => {
    const message = errorOf({ ...local, REQUIRE_SIGN_IN: "true" });
    for (const key of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
      expect(message).toContain(`${key}: missing`);
    }
  });

  it("accepts a complete deployed configuration", () => {
    const env = parseEnv({ ...deployed, OWNER_EMAIL: "owner@example.com", MONTHLY_BUDGET_USD: "7.5" });
    expect(env.REQUIRE_SIGN_IN).toBe(true);
    expect(env.MONTHLY_BUDGET_USD).toBe(7.5);
  });

  it("rejects a REQUIRE_SIGN_IN that is not true or false", () => {
    expect(errorOf({ ...local, REQUIRE_SIGN_IN: "yes" })).toContain("REQUIRE_SIGN_IN:");
  });

  it("rejects half an Upstash configuration", () => {
    expect(errorOf({ ...local, UPSTASH_REDIS_REST_URL: "https://example.upstash.io" })).toContain(
      "UPSTASH_REDIS_REST_TOKEN: missing",
    );
  });

  it("rejects a non-positive budget", () => {
    expect(errorOf({ ...deployed, MONTHLY_BUDGET_USD: "0" })).toContain("MONTHLY_BUDGET_USD:");
  });
});
