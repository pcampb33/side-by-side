import { createAnthropic } from "@ai-sdk/anthropic";
import { stepCountIs, streamText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { ComparisonError, MAX_STEPS, type Backend } from "../run.ts";

// The deployed backend: the Anthropic API through the Vercel AI SDK.
// Opus 5.5 rejects a forced tool_choice, so the prompt asks for tool calls
// and tool_choice stays auto.

// `languageModel` replaces the requested model (tests pass a mock).
export function apiBackend(languageModel?: LanguageModel): Backend {
  return async ({ model, system, user, tools, signal }) => {
    const result = streamText({
      model: languageModel ?? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(model),
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
      includeRawChunks: true,
    });
    // What a failed or cancelled run had used, so the budget still counts it:
    // finished steps exactly; the step in flight, its input from Anthropic's
    // message_start and its output guessed from the characters streamed so
    // far (about 3 to a token, on the high side).
    const used = { inputTokens: 0, outputTokens: 0 };
    let stepInput = 0;
    let stepChars = 0;
    const fail = (message: string) => new ComparisonError(message, { inputTokens: used.inputTokens + stepInput, outputTokens: used.outputTokens + Math.ceil(stepChars / 3) });
    for await (const part of result.fullStream) {
      if (part.type === "raw") {
        const event = part.rawValue as { type?: string; message?: { usage?: { input_tokens?: number } } } | undefined;
        if (event?.type === "message_start") stepInput = event.message?.usage?.input_tokens ?? 0;
      }
      if (part.type === "text-delta" || part.type === "reasoning-delta") stepChars += part.text.length;
      if (part.type === "tool-input-delta") stepChars += part.delta.length;
      if (part.type === "finish-step") {
        used.inputTokens += part.usage.inputTokens ?? 0;
        used.outputTokens += part.usage.outputTokens ?? 0;
        stepInput = stepChars = 0;
      }
      if (part.type === "error") throw fail(`The model run failed: ${part.error instanceof Error ? part.error.message : String(part.error)}`);
      if (part.type === "abort") throw fail("The request was cancelled.");
      if (part.type !== "finish") continue;
      if (part.finishReason === "content-filter") throw fail("Claude declined to build this comparison.");
      // Still asking for tools when the step limit stopped it.
      if (part.finishReason === "tool-calls") throw fail("The model ran out of steps before finishing.");
      if (part.finishReason === "error" || part.finishReason === "length") throw fail(`The model stopped early (${part.finishReason}).`);
      return { inputTokens: part.totalUsage.inputTokens ?? 0, outputTokens: part.totalUsage.outputTokens ?? 0 };
    }
    throw fail("The model run ended without a result.");
  };
}
