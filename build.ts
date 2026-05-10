await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "node",
  format: "esm",
  sourcemap: "external",
  minify: false,
  external: [
    // coloca aquí dependencias que NO quieres empaquetar
    // ejemplo: "zod", "mongodb"
  ],
})

console.log("Build completed")
