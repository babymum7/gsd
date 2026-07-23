export interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

type EventHandler = (params: Record<string, unknown>) => void;

export class CdpClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly endpoint: string) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    const socket = new WebSocket(this.endpoint);
    this.socket = socket;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    socket.addEventListener("close", () => {
      const error = new Error("CDP connection closed");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      if (this.socket === socket) this.socket = null;
      reject(error);
    }, { once: true });
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`CDP connection failed: ${this.endpoint}`)), { once: true });
    try {
      await promise;
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      socket.close();
      throw error;
    }
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || `CDP error ${message.error.code ?? "unknown"}`));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      if (!message.method) return;
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params ?? {});
    });
  }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.socket) await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error("CDP socket unavailable");
    const id = this.nextId++;
    const result = Promise.withResolvers<T>();
    this.pending.set(id, { resolve: result.resolve as (value: unknown) => void, reject: result.reject });
    socket.send(JSON.stringify({ id, method, params }));
    return result.promise;
  }

  on(method: string, handler: EventHandler): () => void {
    const handlers = this.handlers.get(method) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(method, handlers);
    return () => handlers.delete(handler);
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
