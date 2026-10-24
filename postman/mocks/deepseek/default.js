// Local contract fixtures, derived from https://api-docs.deepseek.com/api/create-chat-completion/.
// Scenario path prefixes belong to this fixture server, not to the DeepSeek API.
const http = require("http")
const attempts = new Map()
const usage = { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }

http
  .createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    }
    if (req.method !== "POST" || !pathname.endsWith("/chat/completions")) {
      return json(501, {
        error: { message: "Endpoint not modeled by this fixture." },
      })
    }
    let body = req.body
    if (body === undefined) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      try {
        body = JSON.parse(Buffer.concat(chunks).toString())
      } catch {
        return json(400, { error: { message: "Invalid JSON body." } })
      }
    }
    if (!body.model || !Array.isArray(body.messages) || !body.messages.length) {
      return json(400, {
        error: { message: "model and messages are required." },
      })
    }
    if (
      (body.tool_choice === "required" ||
        typeof body.tool_choice === "object") &&
      body.reasoning_effort !== "none"
    ) {
      return json(400, {
        error: { message: "Forced tools require non-thinking mode." },
      })
    }
    const scenario = pathname.split("/").filter(Boolean)[0]
    const key = pathname + JSON.stringify(body.messages)
    const attempt = (attempts.get(key) ?? 0) + 1
    attempts.set(key, attempt)

    if (scenario === "retry" && attempt === 1)
      return json(429, {
        error: { message: "Rate limit reached.", type: "rate_limit_error" },
      })
    if (scenario === "json-error")
      return json(400, {
        error: { message: "Invalid image.", type: "invalid_request_error" },
      })
    if (scenario === "html-error") {
      res.writeHead(503, { "Content-Type": "text/html" })
      return res.end("<html>upstream unavailable</html>")
    }
    if (scenario === "slow")
      await new Promise((resolve) => setTimeout(resolve, 300))
    if (scenario === "interrupted" && attempt === 1) {
      return json(200, {
        choices: [
          {
            finish_reason: "insufficient_system_resource",
            message: { role: "assistant", content: "partial" },
          },
        ],
        usage,
      })
    }
    if (scenario === "tools") {
      const last = body.messages.at(-1)
      if (last.role === "tool") {
        const assistant = body.messages.at(-2)
        if (
          assistant.reasoning_content !== "  continuation state\n" ||
          assistant.tool_calls?.[0]?.id !== last.tool_call_id
        ) {
          return json(400, {
            error: {
              message: "Missing reasoning_content or matching tool_call_id.",
            },
          })
        }
        return json(200, {
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "Tool result received." },
            },
          ],
          usage,
        })
      }
      return json(200, {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              reasoning_content: "  continuation state\n",
              tool_calls: [
                {
                  id: "call-sim-1",
                  type: "function",
                  function: { name: "lookup", arguments: '{"id":7}' },
                },
              ],
            },
          },
        ],
        usage,
      })
    }
    if (scenario === "vision") {
      const content = body.messages.at(-1)?.content
      const image =
        Array.isArray(content) &&
        content.find((part) => part.type === "image_url")
      if (
        !image?.image_url?.url?.startsWith("data:image/png;base64,iVBORw0KGgo")
      ) {
        return json(400, {
          error: { message: "Expected an inline PNG in user content." },
        })
      }
    }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      res.write(": keep-alive\n\n")
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "continuation state" } }] })}\n\n`
      )
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: scenario === "length" ? '{"partial":' : "Hello 🌎" } }] })}\n\n`
      )
      if (scenario === "disconnect") return res.end()
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: scenario === "length" ? "length" : "stop" }], usage })}\n\n`
      )
      return res.end("data: [DONE]\n\n")
    }
    return json(200, {
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "Complete." },
        },
      ],
      usage,
    })
  })
  .listen(process.env.PORT || 4901)
