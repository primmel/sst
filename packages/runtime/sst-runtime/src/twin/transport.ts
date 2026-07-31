// twin/transport.ts — the shared GraphQL POST + SSE subscription
// transport. Used by BOTH the TwinDriver (twin/) and the WorldDriver
// (world/). Collapses the 5+ duplicated gql() helpers across the
// bench and per-family tests into one.

import type { DriverOpts } from './types.js'

/** One-stop GraphQL POST. Returns the unwrapped `data` object or throws. */
export async function gql(
  url: string,
  query: string,
  opts: { fetch?: (typeof fetch) | undefined; token?: string | undefined } = {},
): Promise<Record<string, unknown>> {
  const f = opts.fetch ?? fetch
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  const res = await f(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  })
  const body = await res.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> }
  if (body.errors && body.errors.length > 0) {
    throw new Error(`GraphQL error: ${body.errors.map(e => e.message).join('; ')}`)
  }
  if (!body.data) {
    throw new Error(`GraphQL response missing data: ${JSON.stringify(body)}`)
  }
  return body.data
}

/** Subscribe to an SSE-streamed GraphQL subscription. Returns an
 *  AsyncIterableIterator matching the server's watchStream protocol
 *  (packages/core/src/twin-schema.ts:144). */
export function subscribe<T>(
  url: string,
  query: string,
  opts: { fetch?: (typeof fetch) | undefined; token?: string | undefined } = {},
): AsyncIterableIterator<T> {
  // An async-iterator backed by a fetch streaming response body.
  // We POST the subscription query; the server replies with text/event-stream.
  const f = opts.fetch ?? fetch
  let cancelled = false
  let pending: T[] = []
  let waiter: ((v: IteratorResult<T>) => void) | undefined
  let streamDone = false

  void (async () => {
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'accept': 'text/event-stream',
      }
      if (opts.token) headers.authorization = `Bearer ${opts.token}`
      const res = await f(url, { method: 'POST', headers, body: JSON.stringify({ query }) })
      const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader()
      if (!reader) throw new Error('no response body for SSE subscription')
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        if (cancelled) { reader.cancel(); return }
        const { done, value } = await reader.read()
        if (done) { streamDone = true; waiter?.({ value: undefined as never, done: true }); return }
        buffer += decoder.decode(value, { stream: true })
        // SSE messages are separated by \n\n. Parse "data: ..." lines.
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const msg = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          for (const line of msg.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload) continue
            try {
              const json = JSON.parse(payload) as { data?: Record<string, unknown> }
              const inner = Object.values(json.data ?? {})[0] as T | undefined
              if (inner !== undefined) deliver(inner)
            } catch {
              // Ignore keepalives and malformed payloads.
            }
          }
        }
      }
    } catch (err) {
      streamDone = true
      waiter?.({ value: undefined as never, done: true })
      // Surface the error asynchronously — see throw() below.
      void err
    }
  })()

  function deliver(value: T): void {
    if (waiter) {
      const w = waiter
      waiter = undefined
      w({ value, done: false })
    } else {
      pending.push(value)
    }
  }

  const self: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() { return self },
    next(): Promise<IteratorResult<T>> {
      if (pending.length > 0) return Promise.resolve({ value: pending.shift()!, done: false })
      if (streamDone) return Promise.resolve({ value: undefined as never, done: true })
      return new Promise(resolve => { waiter = resolve })
    },
    return(): Promise<IteratorResult<T>> {
      cancelled = true
      streamDone = true
      waiter?.({ value: undefined as never, done: true })
      return Promise.resolve({ value: undefined as never, done: true })
    },
    throw(e?: unknown): Promise<IteratorResult<T>> {
      cancelled = true
      streamDone = true
      return Promise.reject(e instanceof Error ? e : new Error(String(e ?? 'subscription error')))
    },
  }
  return self
}

/** Resolve the type-level opts into runtime values. */
export function resolveFetch(o?: DriverOpts): typeof fetch | undefined {
  return o?.fetch
}
