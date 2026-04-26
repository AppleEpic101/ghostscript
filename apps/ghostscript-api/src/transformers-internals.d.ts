declare module "../node_modules/@huggingface/transformers/src/cache_utils.js" {
  export const DynamicCache: new (entries?: Record<string, unknown>) => {
    get_seq_length(): number;
    update(entries: Record<string, unknown>): void;
    dispose(): Promise<void>;
    [key: string]: unknown;
  };
}

declare module "../node_modules/@huggingface/transformers/src/models/modeling_utils.js" {
  export function getPastKeyValues(
    decoderResults: Record<string, unknown>,
    pastKeyValues: {
      get_seq_length(): number;
      update(entries: Record<string, unknown>): void;
      [key: string]: unknown;
    },
  ): {
    get_seq_length(): number;
    update(entries: Record<string, unknown>): void;
    [key: string]: unknown;
  };
}
