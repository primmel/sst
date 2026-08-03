// TODO.ops/29 — the hosted-platform → local-sim seam: the sim answers
// CORS preflights and carries the allow-origin for configured origins,
// and stays silent for strangers (never a wildcard lie).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSimServer } from './server.js'
import { createSchema } from 'graphql-yoga'

const schema = createSchema({ typeDefs: 'type Query { ok: Boolean }', resolvers: { Query: { ok: () => true } } })

test('CORS: configured origin gets preflight + response headers; strangers get nothing', async () => {
  const server = await createSimServer({
    worldSchema: schema,
    port: 0,
    corsOrigins: 'https://app.oimlsmart.org,https://localhost:5190',
  })
  try {
    const url = server.url
    const preflight = await fetch(`${url}/twin`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.oimlsmart.org', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.oimlsmart.org')
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/)

    const res = await fetch(`${url}/world`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.oimlsmart.org' },
      body: JSON.stringify({ query: '{ ok }' }),
    })
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.oimlsmart.org')

    const stranger = await fetch(`${url}/twin`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    })
    assert.equal(stranger.status, 403)
    assert.equal(stranger.headers.get('access-control-allow-origin'), null)
  } finally {
    await server.close()
  }
})

test('CORS: the wildcard posture (a demo sim serves no secrets)', async () => {
  const server = await createSimServer({ worldSchema: schema, port: 0, corsOrigins: '*' })
  try {
    const res = await fetch(`${server.url}/twin`, {
      method: 'OPTIONS',
      headers: { origin: 'https://anywhere.example' },
    })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  } finally {
    await server.close()
  }
})

test('CORS: absent config — no headers (same-origin tools only)', async () => {
  const server = await createSimServer({ worldSchema: schema, port: 0 })
  try {
    const res = await fetch(`${server.url}/twin`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.oimlsmart.org' },
    })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  } finally {
    await server.close()
  }
})
