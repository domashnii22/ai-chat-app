'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';
import { Message } from '@/types';

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentAssistantMessage]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (text === '') return;

    const userMessage: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);
    setCurrentAssistantMessage('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messages.concat(userMessage),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Ошибка сервера');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let isFirstChunk = true;

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const textChunk = parsed.text || '';

              if (textChunk) {
                assistantContent += textChunk;
                setCurrentAssistantMessage(assistantContent);

                if (isFirstChunk) {
                  setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: '' },
                  ]);
                  isFirstChunk = false;
                }

                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.length - 1;
                  if (newMessages[lastIndex]?.role === 'assistant') {
                    newMessages[lastIndex] = {
                      ...newMessages[lastIndex],
                      content: assistantContent,
                    };
                  }
                  return newMessages;
                });
              }
            } catch (e) {
              console.error('❌ Ошибка парсинга:', e);
            }
          }
        }
      }

      if (!assistantContent) {
        setMessages((prev) => prev.filter((msg) => msg.content.trim() !== ''));
        setError('Получен пустой ответ от AI');
      }
    } catch (error) {
      console.error('❌ Ошибка:', error);
      setError(error instanceof Error ? error.message : 'Неизвестная ошибка');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      setCurrentAssistantMessage('');
    }
  };

  const clearHistory = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">💬 Чат с YandexGPT</h1>
        <button
          onClick={clearHistory}
          className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm"
        >
          Очистить историю
        </button>
      </div>

      <div className="space-y-2 mb-4 h-96 overflow-y-auto border rounded-lg p-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            Начните диалог...
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg max-w-[80%] ${
                msg.role === 'user'
                  ? 'ml-auto bg-blue-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              <div className="text-xs opacity-70 mb-1">
                {msg.role === 'user' ? '🧑 Вы' : '🤖 AI'}
              </div>
              <div className="whitespace-pre-wrap">
                {msg.content || <span className="text-gray-400">...</span>}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 max-w-[80%]">
            <div className="text-gray-500">⏳ Печатает...</div>
          </div>
        )}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 p-3 rounded-lg">
            ❌ {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Введите сообщение..."
          className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? '⏳' : '📤 Отправить'}
        </button>
      </form>
    </div>
  );
}
