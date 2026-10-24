import type { TokenUsage } from "./usage"

export type StructuredOutputFormat =
  | {
      type: "json_object"
    }
  | {
      type: "json_schema"
      name: string
      schema: Record<string, unknown>
      strict?: boolean
    }

export type TextFunctionTool = {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
    strict?: boolean
  }
}

export type TextToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } }

export type TextToolCall = {
  id: string
  name: string
  arguments: string
}

export type TextConversationMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant"
      content: string | null
      /** Preserve exactly when continuing a thinking conversation with tools. */
      reasoningContent?: string
      toolCalls?: readonly TextToolCall[]
    }
  | { role: "tool"; content: string; toolCallId: string }

export type TextGenerationCapabilities = {
  streaming: boolean
  functionTools: boolean
  /** An omitted value means conversation history is not supported. */
  conversationHistory?: boolean
  structuredOutput: {
    jsonObject: boolean
    jsonSchema: "enforced" | "best_effort" | "unsupported"
  }
}

export type TextRetryPolicy = {
  maxRetries?: number
  retryDelayMs?: number
}

export type TextGenerationRequest = {
  systemPrompt: string
  maxOutputTokens?: number
  responseFormat?: StructuredOutputFormat
  signal?: AbortSignal
  reasoning?: {
    effort?: "none" | "low" | "medium" | "high" | "max"
  }
  stream?: boolean
  onTextChunk?: (chunk: string) => void | Promise<void>
  timeoutMs?: number
  retryPolicy?: TextRetryPolicy
  tools?: TextFunctionTool[]
  toolChoice?: TextToolChoice
} & (
  | { userPrompt: string; messages?: never }
  | { userPrompt?: never; messages: readonly TextConversationMessage[] }
)

export type TextGenerationResponse = {
  text: string
  usage?: TokenUsage
  toolCalls?: TextToolCall[]
  reasoningContent?: string
  /** DeepSeek returns partial output for length/content_filter; inspect before parsing. */
  finishReason?: string
}

export interface TextGenerationClient {
  readonly capabilities: TextGenerationCapabilities
  readonly model: string

  execute(context: TextGenerationRequest): Promise<TextGenerationResponse>
}
