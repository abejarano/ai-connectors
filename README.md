# @abejarano/ai-connectors

Paquete TypeScript para integrar proveedores de IA mediante adapters neutrales de texto, imagen y vídeo. Expone contratos compartidos, manejo normalizado de errores y utilidades de soporte.

## Características

- Generación de texto con soporte de streaming
- Salida estructurada con JSON Schema
- Generación de texto DeepSeek mediante su API de Chat Completions
- Generación de imágenes con persistencia en archivo
- Generación de video con polling configurable
- Consumo normalizado de tokens y unidades facturables en texto, multimodal, imagen y vídeo
- Errores de transporte normalizados con información de retry
- Selección explícita de proveedor sin dependencias de clientes concretos

## Instalación

```bash
bun add @abejarano/ai-connectors
```

Si prefieres `npm` o `pnpm`:

```bash
npm install @abejarano/ai-connectors
pnpm add @abejarano/ai-connectors
```

## Requisitos

- Node.js 20 o superior
- Una API key válida del proveedor seleccionado
- TypeScript 5 si lo consumes desde un proyecto TS

## API pública

El export raíz del paquete publica actualmente:

- `TextGenerationAdapter`
- `MultimodalGenerationAdapter`
- `ImageGenerationAdapter`
- `VideoGenerationAdapter`
- `TextGenerationAdapterConfig`
- `ImageGenerationAdapterConfig`
- `VideoGenerationAdapterConfig`
- `TextGenerationResponse`
- `TextGenerationRequest`
- `TextGenerationClient`
- `ImageGenerationResponse`
- `ImageGenerationRequest`
- `ImageGenerationClient`
- `ImageGenerationCapabilities`
- `VideoGenerationResponse`
- `VideoGenerationRequest`
- `VideoGenerationClient`
- `VideoGenerationCapabilities`
- `TextGenerationCapabilities`
- `StructuredOutputFormat`
- `TextRetryPolicy`
- `TokenUsage`
- `ImageUsage`
- `VideoUsage`
- `VideoResolution`

## Uso

### Generación de texto

```ts
import { TextGenerationAdapter } from "@abejarano/ai-connectors"

const client = new TextGenerationAdapter({
  provider: "gemini",
  apiKey: process.env.GEMINI_API_KEY!,
  model: "gemini-2.5-flash",
})

const result = await client.execute({
  systemPrompt: "Responde de forma breve y clara.",
  userPrompt: "Escribe una descripción corta de un cuaderno premium.",
  maxOutputTokens: 256,
})

console.log(result.text)
console.log(result.usage)
```

### Texto con streaming

```ts
import { TextGenerationAdapter } from "@abejarano/ai-connectors"

const client = new TextGenerationAdapter({
  provider: "gemini",
  apiKey: process.env.GEMINI_API_KEY!,
  model: "gemini-2.5-flash",
})

const result = await client.execute({
  systemPrompt: "Eres un asistente útil.",
  userPrompt: "Explica semantic-release en un párrafo.",
  stream: true,
  onTextChunk: async (chunk) => {
    process.stdout.write(chunk)
  },
})

console.log(result.text)
```

### Generación de texto con DeepSeek

```ts
import { TextGenerationAdapter } from "@abejarano/ai-connectors"

const client = new TextGenerationAdapter({
  provider: "deepseek",
  apiKey: process.env.DEEPSEEK_API_KEY!,
  model: "deepseek-flash",
})

const result = await client.execute({
  systemPrompt: "Responde de forma breve y clara.",
  userPrompt: "Escribe una descripción corta de un cuaderno premium.",
  maxOutputTokens: 256,
})

console.log(result.text)
console.log(result.usage)
```

DeepSeek soporta streaming y function tools normalizados en `TextGenerationRequest`. Para salida estructurada, garantiza un objeto JSON, pero no la conformidad estricta con JSON Schema: las solicitudes con `responseFormat.strict: true` fallan localmente antes de llamar al proveedor. DeepSeek puede analizar imágenes de entrada, pero no genera imágenes; usa `ImageGenerationAdapter` con `provider: "gemini"` para generar assets.

### Salida estructurada

```ts
import { TextGenerationAdapter } from "@abejarano/ai-connectors"

const client = new TextGenerationAdapter({
  provider: "gemini",
  apiKey: process.env.GEMINI_API_KEY!,
  model: "gemini-2.5-flash",
})

const result = await client.execute({
  systemPrompt: "Devuelve solo JSON válido.",
  userPrompt: "Genera un objeto con title y summary.",
  responseFormat: {
    type: "json_schema",
    name: "summary",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
      },
      required: ["title", "summary"],
      additionalProperties: false,
    },
  },
})

console.log(result.text)
```

Si sólo necesitas garantizar un objeto JSON válido, sin imponer un esquema,
usa la variante `json_object`:

```ts
const result = await client.execute({
  systemPrompt: "Devuelve solo JSON válido.",
  userPrompt: "Genera un objeto con title y summary.",
  responseFormat: { type: "json_object" },
})

console.log(result.text)
```

`StructuredOutputFormat` es una unión discriminada por `type`, por lo que
`type: "json_schema"` conserva `name`, `schema` y el `strict` opcional, mientras
que `type: "json_object"` no envía ningún esquema al proveedor.

### Análisis multimodal

Usa `MultimodalGenerationAdapter` cuando el modelo deba analizar bytes de imagen
y devolver texto o JSON estructurado. El contrato es agnóstico del proveedor;
cada implementación traduce los bytes a su formato nativo sin convertirlos en
una descripción textual. Gemini y DeepSeek están disponibles actualmente.

```ts
import { MultimodalGenerationAdapter } from "@abejarano/ai-connectors"

const client = new MultimodalGenerationAdapter({
  provider: "gemini",
  apiKey: process.env.GEMINI_API_KEY!,
  model: "gemini-2.5-flash",
})

const result = await client.execute({
  systemPrompt: "Devuelve solo JSON válido.",
  userPrompt: "Propón una composición para esta imagen.",
  images: [{ bytes: imageBytes, mimeType: "image/png" }],
  responseFormat: {
    type: "json_schema",
    name: "composition",
    schema: { type: "object" },
  },
})

console.log(result.text)
```

### Generación de imágenes

La generación de imágenes está disponible actualmente sólo con `provider: "gemini"`.

```ts
import { ImageGenerationAdapter } from "@abejarano/ai-connectors"

const client = new ImageGenerationAdapter({
  provider: "gemini",
  apiKey: process.env.GEMINI_API_KEY!,
  model: "gemini-2.0-flash-preview-image-generation",
})

const result = await client.execute({
  prompt: "Una interfaz editorial para un dashboard de IA.",
  outputPath: "./output/image.png",
  width: 1080,
  height: 1350,
  negativePrompt: "evitar texto deformado, baja resolución, manos extra",
})

console.log(result.asset.path)
console.log(result.mimeType)
console.log(result.width, result.height)
```

### Generación de video

La generación de vídeo está disponible actualmente sólo con `provider: "gemini"`.

```ts
import { VideoGenerationAdapter } from "@abejarano/ai-connectors"

const client = new VideoGenerationAdapter({
  provider: "gemini",
  apiKey: process.env.GEMINI_API_KEY!,
  model: "gemini-2.5-flash-video",
})

const result = await client.execute({
  prompt: "Un plano cinematográfico de una ciudad al amanecer.",
  outputPath: "./output/video.mp4",
  width: 1080,
  height: 1920,
  durationSeconds: 8,
})

console.log(result.asset.path)
console.log(result.mimeType)
console.log(result.durationSeconds)
```

## Consumo de tokens y coste

Toda respuesta, sea de texto, multimodal, imagen o vídeo, incluye un `usage`
normalizado y agnóstico del proveedor.

### Qué expone cada adapter

| Adapter            | Campos de `usage`                             | Unidades               |
| ------------------ | --------------------------------------------- | ---------------------- |
| Texto y multimodal | `inputTokens`, `outputTokens`, `totalTokens`  | tokens                 |
| Texto y multimodal | `cachedInputTokens`, `reasoningTokens`        | subconjuntos de tokens |
| Imagen             | `imageCount`, `tokens`                        | imágenes y tokens      |
| Vídeo              | `videoCount`, `durationSeconds`, `resolution` | segundos facturables   |

Contrato de los campos de tokens:

- `inputTokens` es todo lo facturable como entrada: incluye el contenido
  cacheado y los resultados de herramientas.
- `cachedInputTokens` es un subconjunto de `inputTokens`; el input a tarifa
  completa es `inputTokens - cachedInputTokens`.
- `outputTokens` es todo lo facturable como salida: incluye el razonamiento.
- `reasoningTokens` es un subconjunto de `outputTokens`.
- `totalTokens` es el total declarado por el proveedor y coincide con
  `inputTokens + outputTokens`.
- `raw` conserva el payload original del proveedor por si necesitas un desglose
  que la normalización no cubra.

Los subconjuntos nunca se suman dos veces: si sólo te interesa el gasto total,
`inputTokens` y `outputTokens` ya contienen todo lo facturable.

Cómo se construyen esos totales según el proveedor, porque no reportan igual:

- **Gemini** deja los _thoughts_ fuera de `candidatesTokenCount` y los resultados
  de herramientas fuera de `promptTokenCount`, pero los factura y los suma en
  `totalTokenCount`. La normalización los incorpora a `outputTokens` e
  `inputTokens` respectivamente; `reasoningTokens` conserva el desglose.
- **DeepSeek** ya incluye el razonamiento dentro de `completion_tokens` (su
  `completion_tokens_details` es un desglose, no un sumando), así que
  `outputTokens` lo contiene sin sumarlo otra vez.

```ts
const result = await client.execute({
  systemPrompt: "Responde de forma breve.",
  userPrompt: "Escribe un titular.",
})

console.log(result.usage?.inputTokens, result.usage?.outputTokens)
```

### La librería no calcula el precio

Los precios cambian, dependen del contrato de cada cuenta y algunos proveedores
los aplican por franja horaria. Por eso el paquete **devuelve unidades
facturables y nunca las traduce a dinero**: el cálculo es responsabilidad de
cada consumidor, con sus propias tarifas. `usage.estimatedCostUsd` existe
únicamente como hueco para que adjuntes tu resultado; la librería nunca lo
escribe.

Ejemplo con las tarifas publicadas de DeepSeek, que distinguen caché y franja
horaria ([precios oficiales](https://api-docs.deepseek.com/quick_start/pricing)):

```ts
const result = await client.execute({ systemPrompt, userPrompt })
const usage = result.usage

if (usage) {
  const cacheHit = usage.cachedInputTokens ?? 0
  const cacheMiss = (usage.inputTokens ?? 0) - cacheHit
  const output = usage.outputTokens ?? 0
  const isPeak = isDeepSeekPeakHour(new Date()) // 01:00-04:00 y 06:00-10:00 UTC, L-V

  const cacheHitUsd = isPeak ? 0.006 : 0.003 // por 1M tokens
  const cacheMissUsd = isPeak ? 0.3 : 0.15
  const outputUsd = isPeak ? 1.2 : 0.6

  usage.estimatedCostUsd =
    (cacheHit * cacheHitUsd + cacheMiss * cacheMissUsd + output * outputUsd) /
    1_000_000
}
```

En vídeo el proveedor factura por segundo generado, así que las unidades ya
vienen separadas de los tokens:

```ts
const result = await videoClient.execute({
  prompt: "Un plano cinematográfico de una ciudad al amanecer.",
  outputPath: "./output/video.mp4",
  width: 1080,
  height: 1920,
})

if (result.usage) {
  result.usage.estimatedCostUsd =
    result.usage.videoCount * result.usage.durationSeconds * PRICE_PER_SECOND
}
```

## Manejo de errores

El paquete normaliza los fallos del proveedor para que el consumidor pueda reaccionar de forma consistente.

- `TextTransportError`
- `ImageTransportError`
- `VideoTransportError`
- `UnsupportedGenerationProviderError`
- `UnsupportedTextGenerationCapabilityError`

En texto, el error expone un `retryable` en los detalles cuando el fallo parece transitorio.

## Build

```bash
bun run build
```

## Tests

```bash
bun test
```

## Release

Este repositorio usa `semantic-release` en la rama `main`. Los releases se calculan a partir de commits convencionales.

### Tipos que generan release

- `feat`: release menor
- `fix`: release de parche
- `perf`: release de parche
- cambios incompatibles con `!` o con el footer `BREAKING CHANGE:`: release mayor

### Tipos que no generan release por sí solos

- `docs`
- `chore`
- `refactor`
- `test`
- `style`
- `ci`

### Ejemplos

```text
feat(text): add streaming callbacks
fix(video): handle empty generated payload
perf(text): reduce token usage normalization overhead
feat!: change response format contract
```

### Formato recomendado

Usa este patrón:

```text
type(scope): summary
```

Si el cambio rompe compatibilidad, usa:

```text
type(scope)!: summary
```

o el footer:

```text
BREAKING CHANGE: descripción del cambio incompatible
```

## Publicación

El paquete está preparado para publicarse en npm mediante `semantic-release`.

## Licencia

Privado.
