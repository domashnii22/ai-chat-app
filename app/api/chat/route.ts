// app/api/chat/route.ts
import { FilteredMessage, Message } from '@/types';
import { callMCPTool, getMCPTools } from '@/lib/mcp';
import { buildRagContext } from '@/lib/rag';
import { NextResponse } from 'next/server';

const YANDEX_FOLDER_ID = process.env.YC_FOLDER_ID;
const YANDEX_API_KEY = process.env.YC_API_KEY;
const YANDEX_BASE_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1';

// ============================================================
// 1️⃣ ФИЛЬТРАЦИЯ ИСТОРИИ
// ============================================================

function filterHistory(messages: Array<Message>): Array<FilteredMessage> {
  const MAX_HISTORY = 20;
  const filtered: Array<FilteredMessage> = [];

  const errorPhrases = [
    'Модель вернула пустой ответ',
    'Получен пустой ответ от AI',
    'Пустой ответ',
    'Ошибка',
    '❌',
    '🤖 Модель вернула пустой ответ',
  ];

  for (const msg of messages) {
    if (!msg.content || msg.content.trim() === '') continue;

    const contentLower = msg.content.toLowerCase();
    const isError = errorPhrases.some((phrase) =>
      contentLower.includes(phrase.toLowerCase()),
    );
    if (isError) {
      console.log(`⏭️ Пропущено сообщение с ошибкой: "${msg.content}"`);
      continue;
    }

    const lastRole =
      filtered.length > 0 ? filtered[filtered.length - 1].role : null;

    if (msg.role === 'user') {
      if (lastRole === 'user') continue;
      filtered.push({ role: 'user', text: msg.content });
    } else if (msg.role === 'assistant') {
      if (lastRole === 'assistant') continue;
      filtered.push({ role: 'assistant', text: msg.content });
    }
  }

  if (filtered.length > MAX_HISTORY) {
    return filtered.slice(-MAX_HISTORY);
  }

  return filtered;
}

// ============================================================
// 2️⃣ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ЗАПРОСА К YANDEX
// ============================================================

async function callYandex(
  messages: Array<FilteredMessage>,
  stream: boolean,
  tools?: any,
) {
  const body: any = {
    modelUri: `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite/latest`,
    completionOptions: {
      stream,
      temperature: 0.7,
      maxTokens: 1500,
    },
    messages,
  };
  if (tools) body.tools = tools;

  console.log(
    `📤 Запрос к Yandex (stream=${stream}):`,
    JSON.stringify(body, null, 2),
  );

  const response = await fetch(`${YANDEX_BASE_URL}/completion`, {
    method: 'POST',
    headers: {
      Authorization: `Api-Key ${YANDEX_API_KEY}`,
      'x-folder-id': YANDEX_FOLDER_ID!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Yandex API error: ${response.status} - ${errorText}`);
  }

  if (stream) return response; // возвращаем Response для стриминга
  return response.json(); // для не-стрим запроса возвращаем JSON
}

// ============================================================
// 5️⃣ СТРИМИНГ ФИНАЛЬНОГО ОТВЕТА КЛИЕНТУ
// ============================================================

const MAX_AGENT_ITERATIONS = 5;
const STREAM_CHUNK_SIZE = 60;
const STREAM_CHUNK_DELAY_MS = 15;

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, size));
    remaining = remaining.slice(size);
  }
  return chunks.length > 0 ? chunks : [''];
}

function streamTextResponse(text: string): Response {
  const encoder = new TextEncoder();
  const reader = new ReadableStream({
    async start(controller) {
      try {
        const chunks = splitIntoChunks(text, STREAM_CHUNK_SIZE);
        for (const chunk of chunks) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`),
          );
          await new Promise((resolve) =>
            setTimeout(resolve, STREAM_CHUNK_DELAY_MS),
          );
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        console.error('❌ Ошибка при стриминге ответа:', error);
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(reader, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ============================================================
// 6️⃣ ОСНОВНАЯ ЛОГИКА API
// ============================================================

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages' }, { status: 400 });
    }

    if (!YANDEX_FOLDER_ID || !YANDEX_API_KEY) {
      console.error('❌ YANDEX_FOLDER_ID или YANDEX_API_KEY не заданы');
      return NextResponse.json(
        { error: 'Missing Yandex credentials' },
        { status: 500 },
      );
    }

    const filteredMessages = filterHistory(messages);

    if (filteredMessages.length === 0) {
      return NextResponse.json(
        { error: 'No valid messages after filtering' },
        { status: 400 },
      );
    }

    // ------------------------------------------------
    // ШАГ 1: Получаем инструменты из MCP-сервера
    // ------------------------------------------------
    const tools = await getMCPTools();

    console.log(
      `🔧 Инструменты из MCP: ${tools.map((t) => t.function.name).join(', ')}`,
    );

    // ------------------------------------------------
    // ШАГ 1.5: RAG – обогащаем контекст релевантными документами
    // ------------------------------------------------
    let ragMessages: FilteredMessage[] = filteredMessages;

    try {
      const lastUser = [...filteredMessages]
        .reverse()
        .find((m) => m.role === 'user');
      if (lastUser?.text) {
        const ragContext = await buildRagContext(lastUser.text);
        if (ragContext) {
          console.log('📚 RAG-контекст найден:', ragContext.slice(0, 200), '...');
          ragMessages = [
            {
              role: 'system',
              text: `Ниже приведены фрагменты документов из базы знаний, относящиеся к вопросу пользователя. Используй их для ответа, если в них есть нужная информация. Не упоминай, что используешь базу знаний.\n\n${ragContext}`,
            },
            ...filteredMessages,
          ];
        } else {
          console.log('📚 RAG: релевантный контекст не найден');
        }
      }
    } catch (e) {
      console.warn('⚠️ RAG пропущен из-за ошибки:', e);
    }

    // ------------------------------------------------
    // ШАГ 2: Агентный цикл – модель может вызывать инструменты несколько раз
    // ------------------------------------------------
    let currentMessages: FilteredMessage[] = ragMessages;
    let finalText = '';
    let iterations = 0;

    while (iterations < MAX_AGENT_ITERATIONS) {
      iterations++;
      console.log(`🤖 Итерация ${iterations}/${MAX_AGENT_ITERATIONS}`);

      // Запрос без стриминга – проверяем, нужен ли вызов инструмента
      const data = await callYandex(currentMessages, false, tools);
      const alternative = data.result?.alternatives?.[0];
      const message = alternative?.message;
      const toolCallList = message?.toolCallList;

      console.log(
        `📥 Ответ от Yandex (итерация ${iterations}):`,
        JSON.stringify(data, null, 2),
      );

      // Если инструменты не вызваны – это финальный ответ
      if (!toolCallList || toolCallList.toolCalls.length === 0) {
        finalText = message?.text || '';
        console.log(`✅ Финальный ответ получен (итерация ${iterations})`);
        break;
      }

      // ------------------------------------------------
      // ШАГ 3: Выполняем все вызванные инструменты через MCP
      // ------------------------------------------------
      const toolResults: Array<{ functionResult: { name: string; content: string } }> =
        [];

      for (const toolCall of toolCallList.toolCalls) {
        const functionName = toolCall.functionCall.name;
        const args = toolCall.functionCall.arguments;

        console.log(
          `🔧 Вызов MCP-инструмента: ${functionName}(${JSON.stringify(args)})`,
        );

        let functionResult = '';
        try {
          functionResult = await callMCPTool(functionName, args);
        } catch (e) {
          functionResult = `❌ Ошибка вызова инструмента ${functionName}: ${String(e)}`;
        }

        console.log(`📨 Результат MCP-инструмента ${functionName}: ${functionResult}`);
        toolResults.push({ functionResult: { name: functionName, content: functionResult } });
      }

      // ------------------------------------------------
      // ШАГ 4: Добавляем вызов и результаты в историю, продолжаем цикл
      // ------------------------------------------------
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', toolCallList },
        { role: 'user', toolResultList: { toolResults } },
      ];

      console.log(
        `🔄 Обновлённые сообщения (итерация ${iterations}):`,
        JSON.stringify(currentMessages, null, 2),
      );
    }

    // ------------------------------------------------
    // ШАГ 5: Проверяем результат цикла
    // ------------------------------------------------
    if (!finalText) {
      finalText = `⚠️ Не удалось получить финальный ответ за ${MAX_AGENT_ITERATIONS} итераций`;
      console.warn(`⚠️ Лимит итераций исчерпан (${MAX_AGENT_ITERATIONS})`);
    }

    return streamTextResponse(finalText);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
