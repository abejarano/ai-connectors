# Simulación local de DeepSeek

Estas respuestas controladas cubren el contrato de Chat Completions utilizado por
los clientes: https://api-docs.deepseek.com/api/create-chat-completion/ y
https://api-docs.deepseek.com/guides/thinking_mode/.
No son respuestas capturadas de la API real. No se encontró una sesión iniciada
de Postman para buscar un mock oficial; estos fixtures se escribieron a partir
de la documentación revisada. Los prefijos `retry`, `slow`, `tools`, `length`,
`disconnect`, `interrupted`, `json-error` y `html-error` seleccionan casos de prueba
locales y no son rutas de DeepSeek.

Con Postman CLI >= 1.70, iniciar en una terminal:

```sh
postman simulation run postman/simulations/deepseek.sim.yaml --port 4900 --no-history --output ndjson
```

En otra terminal, ejecutar el cliente real con su `fetch` predeterminado:

```sh
DEEPSEEK_SIMULATION_URL=http://127.0.0.1:4900/deepseek bun test src/clients/deepseek-transport.integration.test.ts
```

El log debe mostrar eventos `request` del miembro `deepseek`, incluyendo los
reintentos de errores 429 y las dos solicitudes del ciclo de herramientas.
La prueba comprueba el transporte contra estos fixtures; no verifica cambios
de comportamiento del proveedor real. No necesita credenciales ni publica nada.
Detener el servidor con Ctrl+C al terminar. La suite normal omite estas pruebas
si `DEEPSEEK_SIMULATION_URL` no está definido.
