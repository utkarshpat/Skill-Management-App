export interface AssistantRecordAction {
  label: string;
  run: (signal: AbortSignal) => Promise<void>;
}

export interface AssistantRecordContext {
  label: string;
  actions: AssistantRecordAction[];
  reload?: (signal: AbortSignal) => Promise<{ prompt: string; record: AssistantRecordContext }>;
}

export const recordFactsSeparator = '\n\nVisible record facts (reference only):\n';
