import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

export interface YandexTool {
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL || 'http://localhost:3001/mcp';

let client: Client | null = null;
let cachedTools: YandexTool[] | null = null;

async function getClient(): Promise<Client> {
  if (!client) {
    const transport = new StreamableHTTPClientTransport(
      new URL(MCP_SERVER_URL),
    );
    client = new Client({ name: 'ai-chat-app', version: '0.1.0' });
    await client.connect(transport);
    console.log(`🔌 MCP-клиент подключён: ${MCP_SERVER_URL}`);
  }
  return client;
}

async function resetClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {}
  }
  client = null;
  cachedTools = null;
}

async function withReconnect<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  try {
    return await fn(await getClient());
  } catch {
    await resetClient();
    return fn(await getClient());
  }
}

function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};
  const sanitized = { ...(schema as Record<string, unknown>) };
  delete sanitized.$schema;
  return sanitized;
}

export async function getMCPTools(): Promise<YandexTool[]> {
  if (cachedTools) return cachedTools;

  const { tools } = await withReconnect((c) => c.listTools());

  cachedTools = tools.map((tool) => ({
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeSchema(tool.inputSchema),
    },
  }));

  return cachedTools;
}

export async function callMCPTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await withReconnect((c) =>
    c.callTool({ name, arguments: args }),
  );

  const text = (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return text || '(пустой ответ от инструмента)';
}