export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolContext {
  sessionId?: string;
}

export interface TextProvider {
  streamChat(
    messages: ChatMessage[],
    ctx?: ToolContext,
  ): AsyncGenerator<string>;
}
