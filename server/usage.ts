export interface UsageTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export const EMPTY_USAGE: UsageTotals = {
  model: "unknown",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
};

export function aggregateUsageFromResult(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  requestedModel?: string,
): UsageTotals {
  return {
    model: requestedModel ?? "unknown",
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}
