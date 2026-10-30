import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { ComparisonError, MAX_STEPS, type Backend } from "../run.ts";

// Local development only (CLAUDE_AUTH=login): runs the model on the owner's
// Claude Code login through the Agent SDK, with Claude Code's own tools,
// settings, hooks and skills all switched off so only our tools exist.

// A user-level ANTHROPIC_API_KEY belongs to another project and must never
// reach this app; the CLAUDE_CODE_* variables of an enclosing session would
// change how the child behaves. CLAUDE_HUB_HEADLESS keeps the owner's
// global hooks from treating this run as a session.
function childEnv(): Record<string, string | undefined> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== "ANTHROPIC_API_KEY" && k !== "CLAUDECODE" && !k.startsWith("CLAUDE_CODE_")),
  );
  return { ...env, CLAUDE_HUB_HEADLESS: "1" };
}

export const loginBackend: Backend = async ({ system, user, tools, signal }) => {
  const ui = createSdkMcpServer({
    name: "ui",
    tools: tools.map((t) =>
      tool(t.name, t.description, t.shape, async (args) => {
        const result = t.handle(args);
        return { content: [{ type: "text", text: result.text }], isError: !result.ok };
      }),
    ),
  });
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  signal.addEventListener("abort", () => abortController.abort(), { once: true });

  const run = query({
    prompt: user,
    options: {
      model: "claude-opus-5-5",
      effort: "medium",
      systemPrompt: system,
      tools: [],
      settingSources: [],
      skills: [],
      persistSession: false,
      mcpServers: { ui },
      allowedTools: tools.map((t) => `mcp__ui__${t.name}`),
      maxTurns: MAX_STEPS,
      env: childEnv(),
      abortController,
    },
  });
  for await (const message of run) {
    if (message.type !== "result") continue;
    if (message.stop_reason === "refusal") throw new ComparisonError("Claude declined to build this comparison.");
    if (message.subtype === "error_max_turns") throw new ComparisonError("The model ran out of steps before finishing.");
    if (message.subtype !== "success" || message.is_error) {
      throw new ComparisonError(`The model run failed${"errors" in message && message.errors.length ? `: ${message.errors.join("; ")}` : "."}`);
    }
    return { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
  }
  throw new ComparisonError(signal.aborted ? "The request was cancelled." : "The model run ended without a result.");
};
