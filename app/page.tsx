'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (text === '') return;

    const userMessage: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка сервера');
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.content || 'Пустой ответ',
        },
      ]);
    } catch (error) {
      console.error('❌ Ошибка:', error);
      setError(error instanceof Error ? error.message : 'Неизвестная ошибка');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
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
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 max-w-[80%]">
            <div className="text-gray-500">⏳ Думаю...</div>
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
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? '⏳' : '📤 Отправить'}
        </button>
      </form>
    </div>
  );
}
