import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { ChatRequest } from '@/types';

const YANDEX_FOLDER_ID = process.env.YC_FOLDER_ID;
const YANDEX_API_KEY = process.env.YC_API_KEY;

const openai = new OpenAI({
  apiKey: YANDEX_API_KEY,
  project: YANDEX_FOLDER_ID,
  baseURL: 'https://ai.api.cloud.yandex.net/v1',
});

export async function POST(req: Request) {
  try {
    const { messages }: ChatRequest = await req.json();

    if (messages.length === 0) {
      return NextResponse.json({ error: 'No messages' }, { status: 400 });
    }

    const stream = await openai.chat.completions.create({
      model: `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite`,
      messages: messages,
      temperature: 0.7,
      max_tokens: 1500,
      stream: true,
    });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              const data = JSON.stringify({ text: content });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('❌ Ошибка стрима:', error);
          controller.error(error);
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
