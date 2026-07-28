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

    const yandexMessages = messages.map((msg: any) => {
      let content = msg.content || msg.text || '';

      if (msg.parts) {
        content = msg.parts
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join('');
      }

      return {
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: content,
      };
    });

    if (yandexMessages.length === 0) {
      return NextResponse.json({ error: 'No messages' }, { status: 400 });
    }

    const response = await openai.chat.completions.create({
      model: `gpt://${YANDEX_FOLDER_ID}/yandexgpt-lite`,
      messages: yandexMessages,
      temperature: 0.7,
      max_tokens: 1500,
    });

    const answer = response.choices[0]?.message?.content || '';

    return NextResponse.json({
      role: 'assistant',
      content: answer,
    });
  } catch (error) {
    console.error('❌ Ошибка:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
