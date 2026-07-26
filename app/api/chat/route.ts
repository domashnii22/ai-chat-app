import { deepSeek } from '@ai-sdk/deepseek';
import { streamText } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: deepSeek('deepseek-chat'),
    messages,
  });

  return result.toUIMessageStreamResponse();
}
