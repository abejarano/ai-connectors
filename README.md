# @abejarano/ai-connectors

Paquete TypeScript para integrar proveedores de IA mediante adapters neutrales de texto, imagen y vídeo. Expone contratos compartidos, manejo normalizado de errores y utilidades de soporte.

## Características

- Generación de texto con soporte de streaming
- Salida estructurada con JSON Schema
- Generación de texto DeepSeek mediante su API de Chat Completions
- Generación de imágenes con persistencia en archivo
- Generación de video con polling configurable
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
