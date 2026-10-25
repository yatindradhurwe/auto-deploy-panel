// Stand-in for https://deno.land/std@<version>/http/server.ts, whose serve() needs APIs removed in
// Deno 2. Older Supabase functions import serve() from there; it hands the handler to Deno.serve().
type Handler = (req: Request, info?: unknown) => Response | Promise<Response>

export function serve(handler: Handler | { handler: Handler }, _options?: unknown) {
  const h = typeof handler === 'function' ? handler : handler.handler
  return Deno.serve(h) as unknown as Promise<void>
}

export class Server {
  #handler: Handler
  constructor(opts: { handler: Handler }) { this.#handler = opts.handler }
  listenAndServe() { return serve(this.#handler) }
  close() {}
}
