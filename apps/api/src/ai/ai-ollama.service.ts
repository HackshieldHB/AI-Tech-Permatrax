import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiOllamaService {
  private readonly logger = new Logger(AiOllamaService.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private available: boolean | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('OLLAMA_URL') || 'http://127.0.0.1:11434'
    ).replace(/\/$/, '');
    this.model = this.config.get<string>('OLLAMA_MODEL') || 'llama3.2';
  }

  getModelName(): string {
    return this.model;
  }

  async isAvailable(): Promise<boolean> {
    if (this.available === true) return true;
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      this.available = res.ok;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async chat(
    system: string,
    user: string,
    timeoutMs = 60000,
  ): Promise<{ text: string; used: boolean }> {
    const ok = await this.isAvailable();
    if (!ok) return { text: '', used: false };

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Ollama chat failed: ${res.status}`);
        return { text: '', used: false };
      }
      const data = (await res.json()) as {
        message?: { content?: string };
      };
      return { text: data.message?.content?.trim() || '', used: true };
    } catch (err) {
      this.logger.warn(
        `Ollama chat error: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.available = false;
      return { text: '', used: false };
    }
  }
}
