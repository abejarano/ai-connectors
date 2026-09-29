/**
 * Consumo normalizado, agnóstico de proveedor.
 *
 * Unidades de tokens:
 * - `inputTokens` es todo lo facturable como entrada, e incluye el contenido
 *   cacheado y los resultados de herramientas.
 * - `cachedInputTokens` es un subconjunto de `inputTokens`, facturado con la
 *   tarifa reducida de caché. El input a tarifa completa es
 *   `inputTokens - cachedInputTokens`.
 * - `outputTokens` es todo lo facturable como salida, e incluye el
 *   razonamiento.
 * - `reasoningTokens` es un subconjunto de `outputTokens`.
 * - `totalTokens` es el total declarado por el proveedor y coincide con
 *   `inputTokens + outputTokens`.
 *
 * La librería no traduce estas unidades a dinero: `estimatedCostUsd` queda
 * reservado para que cada consumidor adjunte el resultado de su propio cálculo
 * con los precios que tenga contratados.
 */
export type TokenUsage = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  estimatedCostUsd?: number
  raw?: unknown
}

export type VideoResolution = "720p" | "1080p"

/**
 * Consumo de una generación de imagen. Según el modelo, el proveedor puede
 * facturar por tokens de salida, por imagen o por ambos.
 */
export type ImageUsage = {
  imageCount?: number
  tokens?: TokenUsage
  estimatedCostUsd?: number
}

/**
 * Consumo de una generación de vídeo. Los modelos de vídeo se facturan
 * normalmente por segundo generado, por lo que `durationSeconds` y
 * `resolution` son las unidades que necesita el consumidor para calcular su
 * coste.
 */
export type VideoUsage = {
  videoCount: number
  durationSeconds: number
  resolution: VideoResolution
  tokens?: TokenUsage
  estimatedCostUsd?: number
}
