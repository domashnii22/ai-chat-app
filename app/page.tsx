'use client';

import { useState, FormEvent } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (text === '') return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
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
          messages: [{ role: 'user', text }],
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
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `❌ Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Чат с YandexGPT</h1>

      <div className="space-y-2 mb-4 max-h-96 overflow-y-auto border rounded p-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`p-2 rounded ${msg.role === 'user' ? 'bg-blue-100 text-right' : 'bg-gray-100'}`}
          >
            <strong>{msg.role === 'user' ? '🧑' : '🤖'}</strong> {msg.content}
          </div>
        ))}
        {isLoading && <div className="text-gray-500">⏳ Думаю...</div>}
        {error && <div className="text-red-500">❌ {error}</div>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Введите сообщение..."
          className="flex-1 border rounded px-3 py-2"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {isLoading ? '⏳' : '📤 Отправить'}
        </button>
      </form>
    </div>
  );
}
