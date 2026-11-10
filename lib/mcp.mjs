// MCP server: every loop in loops/ becomes a tool an AI agent can call.
// Loops are read again on every list, so a new recording shows up without a restart.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { listLoops, runLoop } from './loops.mjs'

export async function serve(dir, version) {
  const server = new Server({ name: 'looper', version }, { capabilities: { tools: { listChanged: false } } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await listLoops(dir))
      .filter((l) => l.tool)
      .map((l) => ({ name: l.tool.name, description: l.tool.description, inputSchema: l.tool.inputSchema })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const loop = (await listLoops(dir)).find((l) => l.tool?.name === req.params.name)
    if (!loop) return { isError: true, content: [{ type: 'text', text: `No loop called ${req.params.name}` }] }
    try {
      const result = await runLoop(dir, loop, req.params.arguments || {})
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return { content: [{ type: 'text', text }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] }
    }
  })

  await server.connect(new StdioServerTransport())
}
