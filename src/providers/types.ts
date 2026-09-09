/**
 * Provider seams. Slice 1 only ships the xAI Grok implementations, but every
 * route talks to these interfaces so another vendor can be swapped in later.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface TextProvider {
  readonly name: string;
  /** Streams assistant text deltas, resolving product tool calls internally. */
  streamChat(options: StreamChatOptions): AsyncIterable<string>;
}

export interface EphemeralVoiceToken {
  token: string;
  model: string;
  url: string;
  expiresAt?: string;
}

export interface VoiceProvider {
  readonly name: string;
  /** Mints a short-lived token so the browser never sees the API key. */
  createEphemeralToken(options?: { signal?: AbortSignal }): Promise<EphemeralVoiceToken>;
}
