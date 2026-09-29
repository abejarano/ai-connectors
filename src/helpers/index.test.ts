import { describe, expect, test } from "bun:test"
import { normalizeTokenUsage } from "./index"

describe("normalizeTokenUsage", () => {
  test("normalizes the DeepSeek/OpenAI shape with cache and reasoning breakdowns", () => {
    const raw = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 2 },
    }

    const usage = normalizeTokenUsage(raw)

    expect(usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 15,
      raw,
    })
    // El razonamiento y la caché son subconjuntos: nunca se suman al total.
    expect(usage?.reasoningTokens).toBeLessThanOrEqual(usage?.outputTokens ?? 0)
    expect(usage?.cachedInputTokens).toBeLessThanOrEqual(
      usage?.inputTokens ?? 0
    )
    expect(usage!.inputTokens! + usage!.outputTokens!).toBe(usage!.totalTokens!)
  })

  test("reads the explicit DeepSeek cache-hit counter", () => {
    const usage = normalizeTokenUsage({
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 60,
      prompt_cache_miss_tokens: 40,
      completion_tokens: 20,
      total_tokens: 120,
    })

    expect(usage?.cachedInputTokens).toBe(60)
    // El input a tarifa completa se deriva restando la caché.
    expect(usage!.inputTokens! - usage!.cachedInputTokens!).toBe(40)
  })

  test("folds Gemini thoughts and tool-use prompt tokens into billable totals", () => {
    const raw = {
      promptTokenCount: 100,
      cachedContentTokenCount: 40,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 30,
      toolUsePromptTokenCount: 5,
      totalTokenCount: 155,
    }

    const usage = normalizeTokenUsage(raw)

    expect(usage).toEqual({
      inputTokens: 105,
      cachedInputTokens: 40,
      outputTokens: 50,
      reasoningTokens: 30,
      totalTokens: 155,
      raw,
    })
    // Invariante: el total del proveedor coincide con entrada + salida.
    expect(usage!.inputTokens! + usage!.outputTokens!).toBe(usage!.totalTokens!)
  })

  test("keeps Gemini totals consistent when the model does not think", () => {
    const usage = normalizeTokenUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 120,
    })

    expect(usage?.inputTokens).toBe(100)
    expect(usage?.outputTokens).toBe(20)
    expect(usage?.reasoningTokens).toBeUndefined()
    expect(usage?.totalTokens).toBe(120)
  })

  test("bills Gemini thoughts as output for thinking models", () => {
    const usage = normalizeTokenUsage({
      promptTokenCount: 200,
      candidatesTokenCount: 10,
      thoughtsTokenCount: 400,
      totalTokenCount: 610,
    })

    // Gemini reporta los thoughts fuera de candidatesTokenCount y los factura
    // como salida, así que outputTokens debe incluirlos.
    expect(usage?.outputTokens).toBe(410)
    expect(usage?.reasoningTokens).toBe(400)
    expect(usage?.totalTokens).toBe(610)
    expect(usage!.inputTokens! + usage!.outputTokens!).toBe(usage!.totalTokens!)
  })

  test("does not add Gemini thoughts twice when a generic output count is present", () => {
    const usage = normalizeTokenUsage({
      output_tokens: 410,
      thoughtsTokenCount: 400,
    })

    expect(usage?.outputTokens).toBe(410)
    expect(usage?.reasoningTokens).toBe(400)
  })

  test("does not add tool-use prompt tokens twice when a generic input count is present", () => {
    const usage = normalizeTokenUsage({
      input_tokens: 205,
      toolUsePromptTokenCount: 5,
    })

    expect(usage?.inputTokens).toBe(205)
  })

  test("reports reasoning-only payloads instead of dropping them", () => {
    const usage = normalizeTokenUsage({ thoughtsTokenCount: 12 })

    expect(usage?.outputTokens).toBe(12)
    expect(usage?.reasoningTokens).toBe(12)
  })

  test("reads the Responses-style input/output token fields", () => {
    const usage = normalizeTokenUsage({
      input_tokens: 70,
      input_tokens_details: { cached_tokens: 30 },
      output_tokens: 8,
      output_tokens_details: { reasoning_tokens: 3 },
    })

    expect(usage?.inputTokens).toBe(70)
    expect(usage?.cachedInputTokens).toBe(30)
    expect(usage?.outputTokens).toBe(8)
    expect(usage?.reasoningTokens).toBe(3)
    expect(usage?.totalTokens).toBe(78)
  })

  test("derives the total when the provider omits it", () => {
    const usage = normalizeTokenUsage({
      prompt_tokens: 7,
      completion_tokens: 3,
    })

    expect(usage?.totalTokens).toBe(10)
  })

  test("never invents an input count from the cached subset", () => {
    const usage = normalizeTokenUsage({
      prompt_tokens_details: { cached_tokens: 9 },
    })

    expect(usage?.cachedInputTokens).toBe(9)
    expect(usage?.inputTokens).toBeUndefined()
    expect(usage?.totalTokens).toBeUndefined()
  })

  test("preserves unrecognized payloads as raw and ignores non-objects", () => {
    const raw = { some_future_counter: 5 }

    expect(normalizeTokenUsage(raw)).toEqual({ raw })
    expect(normalizeTokenUsage(undefined)).toBeUndefined()
    expect(normalizeTokenUsage(null)).toBeUndefined()
    expect(normalizeTokenUsage("usage")).toBeUndefined()
    expect(normalizeTokenUsage(42)).toBeUndefined()
  })
})
