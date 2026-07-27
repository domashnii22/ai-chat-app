import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const YANDEX_FOLDER_ID = process.env.YC_FOLDER_ID;
const YANDEX_API_KEY = process.env.YC_API_KEY;

const openai = new OpenAI({
  apiKey: YANDEX_API_KEY,
  project: YANDEX_FOLDER_ID,
  baseURL: 'https://ai.api.cloud.yandex.net/v1',
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const lastMessage = messages[messages.length - 1];
    const userText = lastMessage?.text || lastMessage?.content || '';

    if (!userText.trim()) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }

    const response = await openai.responses.create({
      model: `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite`,
      input: userText,
      temperature: 0.7,
      max_output_tokens: 1500,
    });

    const answer = response.output_text || '';

    // 5. Возвращаем ответ
    return NextResponse.json({
      role: 'assistant',
      content: answer,
    });
  } catch (error) {
    console.error('❌ Ошибка:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
