// types/index.ts

/**
 * Базовое сообщение для фронтенда и бэкенда (запросы от клиента)
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Сообщение для отправки в Yandex API.
 * Может содержать текст или вызовы функций.
 */
export interface YandexMessage {
  role: 'user' | 'assistant';
  text?: string;
  toolCallList?: {
    toolCalls: Array<{
      functionCall: {
        name: string;
        arguments: Record<string, any>;
      };
    }>;
  };
  toolResultList?: {
    toolResults: Array<{
      functionResult: {
        name: string;
        content: string;
      };
    }>;
  };
}

/**
 * Тип для отфильтрованных сообщений (используется в filterHistory)
 * По сути тот же YandexMessage, но может быть без toolCallList/toolResultList
 */
export type FilteredMessage = YandexMessage;
