import type { TextUsage } from "./index"

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

export type TextGenerationCapabilities = {
  streaming: boolean
  functionTools: boolean
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
  userPrompt: string
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
}

export type TextGenerationResponse = {
  text: string
  usage?: TextUsage
  toolCalls?: TextToolCall[]
}

export interface TextGenerationClient {
  readonly capabilities: TextGenerationCapabilities
  readonly model: string

  execute(context: TextGenerationRequest): Promise<TextGenerationResponse>
}
