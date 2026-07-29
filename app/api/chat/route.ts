import { FilteredMessage, Message } from '@/types';
import { NextResponse } from 'next/server';

const YANDEX_FOLDER_ID = process.env.YC_FOLDER_ID;
const YANDEX_API_KEY = process.env.YC_API_KEY;
const YANDEX_BASE_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1';

function filterHistory(messages: Array<Message>) {
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

    const requestBody = {
      modelUri: `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite/latest`,
      completionOptions: {
        stream: true,
        temperature: 0.7,
        maxTokens: 1500,
      },
      messages: filteredMessages,
    };

    const response = await fetch(`${YANDEX_BASE_URL}/completion`, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${YANDEX_API_KEY}`,
        'x-folder-id': YANDEX_FOLDER_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Yandex API Error:', response.status, errorText);
      return NextResponse.json(
        { error: `Yandex API error: ${response.status}` },
        { status: response.status },
      );
    }

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) {
          controller.close();
          return;
        }

        try {
          let fullResponse = '';
          let accumulatedText = '';

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

              if (trimmedLine.startsWith('data: ')) {
                const data = trimmedLine.slice(6).trim();
                if (data === '[DONE]') continue;

                try {
                  const json = JSON.parse(data);
                  text = json.result?.alternatives?.[0]?.message?.text || '';
                } catch (e) {
                  console.error('❌ Ошибка парсинга SSE:', e);
                }
              } else if (trimmedLine.startsWith('{')) {
                try {
                  const json = JSON.parse(trimmedLine);
                  text = json.result?.alternatives?.[0]?.message?.text || '';
                } catch (e) {
                  console.error('❌ Ошибка парсинга JSON:', e);
                }
              }

              if (text) {
                if (accumulatedText && text.includes(accumulatedText)) {
                  const newPart = text.replace(accumulatedText, '');
                  if (newPart) {
                    accumulatedText = text;
                    fullResponse += newPart;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ text: newPart })}\n\n`,
                      ),
                    );
                  } else {
                    console.log(
                      `⏭️ Пропускаем дублирующийся чанк (уже отправлен)`,
                    );
                  }
                } else {
                  accumulatedText = text;
                  fullResponse += text;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
                  );
                }
              }
            }
          }

          if (!fullResponse || fullResponse.trim() === '') {
            console.warn('⚠️ Пустой ответ от Yandex');
            const errorMsg =
              '🤖 Модель вернула пустой ответ. Попробуйте переформулировать вопрос.';
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: errorMsg })}\n\n`),
            );
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('❌ Ошибка в стриме:', error);
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(readableStream, {
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
