# @abejarano/ai-connectors

Paquete TypeScript para integrar Google Gemini con una API pequeña y enfocada. Expone clientes para generación de texto, imagen y video, junto con tipos compartidos, manejo normalizado de errores y utilidades de soporte.

## Características

- Generación de texto con soporte de streaming
- Salida estructurada con JSON Schema
- Generación de imágenes con persistencia en archivo
- Generación de video con polling configurable
- Errores de transporte normalizados con información de retry
- Tipos ligeros para integrar el paquete sin capas extra

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
- Una API key válida de Google Gemini
- TypeScript 5 si lo consumes desde un proyecto TS

## API pública

El export raíz del paquete publica actualmente:

- `GeminiGenerateImageClient`
- `ImageGenerationResponse`
- `ImageGenerationRequest`
- `GeminiGenerateTextClient`
- `TextGenerationResponse`
- `TextGenerationRequest`
- `StructuredOutputFormat`
- `TextRetryPolicy`
- `GeminiGenerateVideoClient`
- `VideoGenerationResponse`
- `VideoGenerationRequest`

## Uso

### Generación de texto

```ts
import { GeminiGenerateTextClient } from "@abejarano/ai-connectors"

const client = new GeminiGenerateTextClient({
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
import { GeminiGenerateTextClient } from "@abejarano/ai-connectors"

const client = new GeminiGenerateTextClient({
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

### Salida estructurada

```ts
import { GeminiGenerateTextClient } from "@abejarano/ai-connectors"

const client = new GeminiGenerateTextClient({
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

### Generación de imágenes

```ts
import { GeminiGenerateImageClient } from "@abejarano/ai-connectors"

const client = new GeminiGenerateImageClient({
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

```ts
import { GeminiGenerateVideoClient } from "@abejarano/ai-connectors"

const client = new GeminiGenerateVideoClient({
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

## Manejo de errores

El paquete normaliza los fallos del proveedor para que el consumidor pueda reaccionar de forma consistente.

- `TextTransportError`
- `ImageTransportError`
- `VideoTransportError`

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
