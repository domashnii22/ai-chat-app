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

export interface ResourceInfo {
  uri: string;
  name: string;
  mimeType?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
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

// ============================================================
// RESOURCES
// ============================================================

export async function listMCPResources(): Promise<ResourceInfo[]> {
  const { resources } = await withReconnect((c) => c.listResources());
  return resources.map((r) => ({
    uri: r.uri,
    name: r.name,
    mimeType: r.mimeType,
  }));
}

export async function readMCPResource(uri: string): Promise<string> {
  const result = await withReconnect((c) => c.readResource({ uri }));
  return result.contents
    .map((block) => {
      if ('text' in block) return block.text;
      return `[blob: ${block.blob?.length ?? 0} байт]`;
    })
    .join('\n');
}

// ============================================================
// PROMPTS
// ============================================================

export async function listMCPPrompts(): Promise<PromptInfo[]> {
  const { prompts } = await withReconnect((c) => c.listPrompts());
  return prompts.map((p) => ({
    name: p.name,
    description: p.description,
  }));
}

function promptContentToText(
  content: unknown,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => {
      const b = block as { type?: string; text?: string };
      return b.type === 'text' ? b.text || '' : `[${b.type ?? 'unknown'}]`;
    })
    .join('\n');
}

export async function getMCPPrompt(
  name: string,
  args: Record<string, string> = {},
): Promise<string> {
  const result = await withReconnect((c) =>
    c.getPrompt({ name, arguments: args }),
  );
  const lines = (result.messages ?? []).map((m) => {
    const text = promptContentToText(m.content);
    return `${m.role}: ${text}`;
  });
  return lines.join('\n');
}

// ============================================================
// TOOLS (включая синтетические read_resource / get_prompt)
// ============================================================

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

  try {
    const [resources, prompts] = await Promise.all([
      listMCPResources(),
      listMCPPrompts(),
    ]);

    if (resources.length > 0) {
      cachedTools.push({
        function: {
          name: 'read_resource',
          description: `Читает ресурс (файл/документ) по URI и возвращает его содержимое. Доступные ресурсы: ${resources
            .map((r) => `${r.name} (${r.uri})`)
            .join(', ')}`,
          parameters: {
            type: 'object',
            properties: {
              uri: {
                type: 'string',
                description: 'URI ресурса для чтения',
              },
            },
            required: ['uri'],
          },
        },
      });
    }

    if (prompts.length > 0) {
      cachedTools.push({
        function: {
          name: 'get_prompt',
          description: `Получает шаблон промпта по имени и возвращает его сообщения. Доступные промпты: ${prompts
            .map((p) => `${p.name}: ${p.description ?? ''}`)
            .join('; ')}`,
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Имя промпта' },
              arguments: {
                type: 'object',
                description: 'Аргументы промпта (зависят от шаблона)',
              },
            },
            required: ['name'],
          },
        },
      });
    }
  } catch (e) {
    console.warn('⚠️ Не удалось получить resources/prompts:', e);
  }

  return cachedTools;
}

export async function callMCPTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === 'read_resource') {
    return readMCPResource(String(args.uri));
  }

  if (name === 'get_prompt') {
    const promptArgs = (args.arguments as Record<string, string> | undefined) ?? {};
    return getMCPPrompt(String(args.name), promptArgs);
  }

  const result = await withReconnect((c) =>
    c.callTool({ name, arguments: args }),
  );

  const text = (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return text || '(пустой ответ от инструмента)';
}