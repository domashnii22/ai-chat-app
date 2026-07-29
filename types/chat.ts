export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface FilteredMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatRequest {
  messages: Message[];
}
