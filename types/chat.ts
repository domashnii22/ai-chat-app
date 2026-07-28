export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: Message[];
}
