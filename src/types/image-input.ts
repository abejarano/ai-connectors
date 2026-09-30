/**
 * Imagen de entrada, en bytes y sin transformar.
 *
 * La librería nunca recodifica el contenido: los bytes viajan tal cual al
 * proveedor, codificados en base64 sólo para el transporte, y `mimeType` se
 * declara explícitamente porque el proveedor no lo adivina a partir de los
 * bytes.
 */
export type ImageInput = {
  bytes: Uint8Array
  mimeType: string
}
