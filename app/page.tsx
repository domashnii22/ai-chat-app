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
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-4/5 max-w-4xl bg-white rounded-lg shadow-lg overflow-hidden flex flex-col h-[90vh] max-h-[800px]">
        <div className="bg-blue-600 text-white px-6 py-4 flex justify-between items-center flex-shrink-0">
          <div>
            <h1 className="text-2xl font-bold">💬 Чат с YandexGPT</h1>
            <p className="text-sm text-blue-100">Спроси меня что угодно!</p>
          </div>
          <button
            onClick={clearHistory}
            className="px-3 py-1 bg-blue-700 hover:bg-blue-800 rounded text-sm transition-colors"
          >
            Очистить
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <p className="text-lg">💬 Начните диалог</p>
                <p className="text-sm">Напишите сообщение ниже</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
                    }`}
                  >
                    <div
                      className={`text-xs font-semibold mb-1 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-500'}`}
                    >
                      {msg.role === 'user' ? '🧑 Вы' : '🤖 AI'}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {msg.content || (
                        <span className="text-gray-400 italic">
                          Пустой ответ...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 rounded-bl-sm shadow-sm">
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                  </div>
                </div>
              )}
              {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
                  <p className="font-bold">⚠️ Ошибка:</p>
                  <p className="text-sm">{error}</p>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-gray-200 p-4 bg-white flex-shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Введите сообщение..."
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                isLoading || !input.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:transform active:scale-95'
              }`}
            >
              {isLoading ? '⏳' : '📤 Отправить'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
