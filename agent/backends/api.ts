import { createAnthropic } from "@ai-sdk/anthropic";
import { stepCountIs, streamText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { ComparisonError, MAX_STEPS, type Backend } from "../run.ts";

// The deployed backend: the Anthropic API through the Vercel AI SDK.
// Opus 5.5 rejects a forced tool_choice, so the prompt asks for tool calls
// and tool_choice stays auto.

export function apiBackend(model: LanguageModel = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })("claude-opus-5-5")): Backend {
  return async ({ system, user, tools, signal }) => {
    const result = streamText({
      model,
      system,
      prompt: user,
      tools: Object.fromEntries(
        tools.map((t) => [
          t.name,
          tool({
            description: t.description,
            inputSchema: z.object(t.shape),
            // The AI SDK validates input against the schema before execute;
            // a failure there reaches the model as a tool error it can fix.
            execute: async (input) => {
              const { ok, text } = t.handle(input);
              if (!ok) throw new Error(text);
              return text;
            },
          }),
        ]),
      ),
      stopWhen: stepCountIs(MAX_STEPS),
      providerOptions: { anthropic: { effort: "medium" } },
      abortSignal: signal,
    });
    for await (const part of result.fullStream) {
      if (part.type === "error") throw new ComparisonError(`The model run failed: ${part.error instanceof Error ? part.error.message : String(part.error)}`);
      if (part.type === "abort") throw new ComparisonError("The request was cancelled.");
      if (part.type !== "finish") continue;
      if (part.finishReason === "content-filter") throw new ComparisonError("Claude declined to build this comparison.");
      // Still asking for tools when the step limit stopped it.
      if (part.finishReason === "tool-calls") throw new ComparisonError("The model ran out of steps before finishing.");
      if (part.finishReason === "error" || part.finishReason === "length") throw new ComparisonError(`The model stopped early (${part.finishReason}).`);
      return { inputTokens: part.totalUsage.inputTokens ?? 0, outputTokens: part.totalUsage.outputTokens ?? 0 };
    }
    throw new ComparisonError("The model run ended without a result.");
  };
}
