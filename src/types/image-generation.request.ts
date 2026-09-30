import type { ImageInput } from "./image-input"
import type { TextRetryPolicy } from "./text-generation.request"
import type { ImageUsage } from "./usage"

export type ImageAssetRef = {
  kind: "file"
  path: string
}

export type ImageGenerationResponse = {
  asset: ImageAssetRef
  mimeType: string
  sizeBytes: number
  width: number
  height: number
  usage?: ImageUsage
}

export type ImageGenerationCapabilities = {
  provider: "gemini"
  negativePrompt: boolean
  aspectRatio: boolean
  /**
   * `true` sólo cuando `edit()` está disponible para el modelo configurado.
   * No es una constante del proveedor: depende del modelo.
   */
  imageEdit: boolean
}

export type ImageGenerationRequest = {
  prompt: string
  outputPath: string
  width: number
  height: number

  negativePrompt?: string
  signal?: AbortSignal
  /**
   * @remarks Todavía **no implementado** en la generación de imágenes: el
   * cliente de Gemini sólo propaga `signal`. No asumas que acota la llamada.
   */
  timeoutMs?: number
  /**
   * @remarks Todavía **no implementado** en la generación de imágenes: el
   * cliente de Gemini no reintenta. No asumas que acota la llamada.
   */
  retryPolicy?: TextRetryPolicy
}

/**
 * Transformación de una imagen existente: `image` es la base de la edición y
 * `prompt` describe el cambio.
 *
 * El modelo recibe la imagen como punto de partida y genera una versión
 * transformada. Preservar el sujeto, la geometría o la escena **no es una
 * garantía contractual del modelo**: depende de cada modelo y de cada
 * instrucción, así que hay que verificarlo en el caso de uso concreto.
 *
 * Es una operación distinta de `execute()`: nunca se degrada a text-to-image si
 * el modelo no soporta edición, sino que falla con
 * `UnsupportedImageEditCapabilityError`.
 */
export type ImageEditRequest = {
  image: ImageInput
  prompt: string
  outputPath: string

  /**
   * Única vía de cancelación soportada hoy. No se exponen `timeoutMs` ni
   * `retryPolicy` para no prometer un comportamiento que `edit()` no aplica:
   * la normalización de timeout y reintentos de toda la capability de imagen
   * se decidirá aparte.
   */
  signal?: AbortSignal
}

export interface ImageGenerationClient {
  readonly capabilities: ImageGenerationCapabilities
  readonly model: string

  execute(context: ImageGenerationRequest): Promise<ImageGenerationResponse>

  edit(context: ImageEditRequest): Promise<ImageGenerationResponse>
}
