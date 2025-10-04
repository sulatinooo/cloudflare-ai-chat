interface Env {
  AI: any;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export class Conversation {
  state: DurableObjectState;
  env: Env;
  messages: Message[];

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.messages = [];
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    await this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Message[]>('messages');
      this.messages = stored || [];
    });

    if (url.pathname === '/chat' && request.method === 'POST') {
      const { message } = await request.json();

      this.messages.push({
        role: 'user',
        content: message,
        timestamp: Date.now(),
      });

      const aiMessages = this.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const aiResponse = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: aiMessages,
      });

      const assistantMessage = aiResponse.response;

      this.messages.push({
        role: 'assistant',
        content: assistantMessage,
        timestamp: Date.now(),
      });

      await this.state.storage.put('messages', this.messages);

      return new Response(
        JSON.stringify({
          response: assistantMessage,
          messageCount: this.messages.length,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname === '/history' && request.method === 'GET') {
      return new Response(JSON.stringify({ messages: this.messages }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  }
}
