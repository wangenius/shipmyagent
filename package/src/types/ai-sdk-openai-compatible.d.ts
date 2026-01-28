declare module '@ai-sdk/openai-compatible' {
  // Optional dependency: we only need the factory function at runtime.
  // When the package is installed, its real types will take precedence.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const createOpenAICompatible: any;
}

