// app/api/chat/route.ts
import { FilteredMessage, Message } from '@/types';
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
// 2️⃣ ОПИСАНИЕ ИНСТРУМЕНТА
// ============================================================

const tools = [
  {
    function: {
      name: 'weatherTool',
      description: 'Получает текущую погоду в указанном городе.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'Название города, например, Москва',
          },
        },
        required: ['city'],
      },
    },
  },
];

// ============================================================
// 3️⃣ РЕАЛИЗАЦИЯ ФУНКЦИИ (МОК)
// ============================================================

async function weatherTool(city: string): Promise<string> {
  console.log(`🌤️ Вызов weatherTool с городом: ${city}`);
  const weatherData: Record<string, string> = {
    москва: '22°C, ☀️ Солнечно',
    'санкт-петербург': '18°C, ⛅️ Облачно',
    казань: '20°C, 🌧 Дождь',
    новосибирск: '15°C, ❄️ Снег',
  };
  const key = city.toLowerCase();
  const result =
    weatherData[key] || `20°C, ⛅️ Переменная облачность в городе ${city}`;
  console.log(`📨 Результат weatherTool: ${result}`);
  return result;
}

// ============================================================
// 4️⃣ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ЗАПРОСА К YANDEX
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
// 5️⃣ ФУНКЦИЯ ДЛЯ ПРЕОБРАЗОВАНИЯ СТРИМА YANDEX В НАШ ФОРМАТ
// ============================================================

function transformYandexStream(yandexResponse: Response): ReadableStream {
  const encoder = new TextEncoder();
  const reader = yandexResponse.body?.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      if (!reader) {
        controller.close();
        return;
      }

      let buffer = '';
      let accumulatedText = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            let text = '';

            // Парсим SSE от Yandex
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const json = JSON.parse(data);
                text = json.result?.alternatives?.[0]?.message?.text || '';
              } catch (e) {
                console.error('❌ Ошибка парсинга SSE от Yandex:', e);
              }
            } else if (trimmedLine.startsWith('{')) {
              // Иногда Yandex присылает JSON без префикса data:
              try {
                const json = JSON.parse(trimmedLine);
                text = json.result?.alternatives?.[0]?.message?.text || '';
              } catch (e) {
                console.error('❌ Ошибка парсинга JSON от Yandex:', e);
              }
            }

            if (text) {
              // Проверяем, не дублируется ли текст
              if (accumulatedText && text.includes(accumulatedText)) {
                const newPart = text.replace(accumulatedText, '');
                if (newPart) {
                  accumulatedText = text;
                  // Отправляем новую часть клиенту в нашем формате
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ text: newPart })}\n\n`,
                    ),
                  );
                }
              } else {
                accumulatedText = text;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
                );
              }
            }
          }
        }

        // Отправляем сигнал завершения
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        console.error('❌ Ошибка при преобразовании стрима:', error);
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
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
    // ШАГ 1: Первый запрос (без стриминга) – проверяем, нужна ли функция
    // ------------------------------------------------
    const initialData = await callYandex(filteredMessages, false, tools);
    const alternative = initialData.result?.alternatives?.[0];
    const toolCallList = alternative?.message?.toolCallList;

    console.log(
      '📥 Ответ от Yandex (первый запрос):',
      JSON.stringify(initialData, null, 2),
    );

    // ------------------------------------------------
    // ШАГ 2: Если функция вызвана – выполняем её
    // ------------------------------------------------
    if (toolCallList && toolCallList.toolCalls.length > 0) {
      const toolCall = toolCallList.toolCalls[0];
      const functionName = toolCall.functionCall.name;
      const args = toolCall.functionCall.arguments;

      console.log(`🔧 Вызов функции: ${functionName}(${JSON.stringify(args)})`);

      let functionResult = '';
      if (functionName === 'weatherTool') {
        functionResult = await weatherTool(args.city);
      } else {
        functionResult = `❌ Неизвестная функция: ${functionName}`;
      }

      // ------------------------------------------------
      // ШАГ 3: Формируем обновлённые сообщения (история + вызов + результат)
      // ------------------------------------------------
      const updatedMessages: FilteredMessage[] = [
        ...filteredMessages,
        {
          role: 'assistant',
          toolCallList: {
            toolCalls: toolCallList.toolCalls,
          },
        },
        {
          role: 'user',
          toolResultList: {
            toolResults: [
              {
                functionResult: {
                  name: functionName,
                  content: functionResult,
                },
              },
            ],
          },
        },
      ];

      console.log(
        '📤 Обновлённые сообщения для второго запроса:',
        JSON.stringify(updatedMessages, null, 2),
      );

      // ------------------------------------------------
      // ШАГ 4: Второй запрос – уже со стримингом
      // ------------------------------------------------
      const streamResponse = await callYandex(updatedMessages, true, tools);

      // Преобразуем стрим от Yandex в наш формат
      const transformedStream = transformYandexStream(streamResponse);

      return new Response(transformedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // ------------------------------------------------
    // Если функция не вызывалась – сразу стримим ответ
    // ------------------------------------------------
    console.log('💬 Функция не вызвана, стримим прямой ответ');
    const streamResponse = await callYandex(filteredMessages, true);

    // Преобразуем стрим от Yandex в наш формат
    const transformedStream = transformYandexStream(streamResponse);

    return new Response(transformedStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('❌ Ошибка:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
