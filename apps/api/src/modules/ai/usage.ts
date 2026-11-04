export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
}
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function responsesUsage(value: unknown): TokenUsage {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const input = data.input_tokens_details as Record<string, unknown> | undefined;
  const output = data.output_tokens_details as Record<string, unknown> | undefined;
  return {
    inputTokens: count(data.input_tokens),
    // Responses output_tokens already includes reasoning; never add it twice.
    outputTokens: count(data.output_tokens),
    thinkingTokens: count(output?.reasoning_tokens),
    cachedInputTokens: count(input?.cached_tokens),
    totalTokens: count(data.total_tokens),
  };
}
export class UsageMeter {
  private calls: TokenUsage[] = [];
  begin() {
    const index = this.calls.length;
    this.calls.push(responsesUsage(undefined));
    return (usage: TokenUsage) => {
      this.calls[index] = usage;
    };
  }
  record(usage?: TokenUsage) {
    this.calls.push(usage ?? responsesUsage(undefined));
  }
  snapshot() {
    const sum = (key: keyof TokenUsage) =>
      this.calls.length === 0
        ? 0
        : this.calls.some(call => call[key] === null)
          ? null
          : this.calls.reduce((total, call) => total + call[key]!, 0);
    return {
      modelCalls: this.calls.length,
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      thinkingTokens: sum('thinkingTokens'),
      cachedInputTokens: sum('cachedInputTokens'),
      totalTokens: sum('totalTokens'),
    };
  }
}
