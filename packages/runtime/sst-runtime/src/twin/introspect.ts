// twin/introspect.ts — schema discovery for clients that don't have
// the baked contract artifact. Runs the standard GraphQL introspection
// query against a running /twin endpoint and returns a typed summary
// of the model-generated surface.
//
// This is the discovery path documented in specs/12-external-graphql-api.md
// §5.4. Clients that want strong typing should prefer the baked
// contract + TwinDriver<C>; clients that want runtime discovery use
// this.

import { gql } from './transport.js'

/** A summary of a /twin schema's surface — what the model declares. */
export interface TwinIntrospection {
  /** The instrument id (from the GraphQL schema's `instrumentId`, when exposed). */
  queryFields: string[]
  mutationFields: string[]
  subscriptionFields: string[]
}

const INTROSPECTION_QUERY = /* GraphQL */ `{
  __schema {
    queryType { fields { name } }
    mutationType { fields { name } }
    subscriptionType { fields { name } }
  }
}`

/** Introspect a running /twin endpoint and return the field summary.
 *  Useful for clients that don't have the baked contract artifact and
 *  need to discover what the model declares at runtime. */
export async function introspectTwin(
  url: string,
  opts: { fetch?: typeof fetch; token?: string } = {},
): Promise<TwinIntrospection> {
  const data = await gql(`${url}/twin`, INTROSPECTION_QUERY, opts) as {
    __schema?: {
      queryType?: { fields?: Array<{ name: string }> }
      mutationType?: { fields?: Array<{ name: string }> } | null
      subscriptionType?: { fields?: Array<{ name: string }> } | null
    }
  }
  const schema = data.__schema ?? {}
  return {
    queryFields: (schema.queryType?.fields ?? []).map((f) => f.name),
    mutationFields: (schema.mutationType?.fields ?? []).map((f) => f.name),
    subscriptionFields: (schema.subscriptionType?.fields ?? []).map((f) => f.name),
  }
}

/** Introspect a running /world endpoint. Returns the same summary shape. */
export async function introspectWorld(
  url: string,
  opts: { fetch?: typeof fetch; token?: string } = {},
): Promise<TwinIntrospection> {
  const data = await gql(`${url}/world`, INTROSPECTION_QUERY, opts) as {
    __schema?: {
      queryType?: { fields?: Array<{ name: string }> }
      mutationType?: { fields?: Array<{ name: string }> } | null
      subscriptionType?: { fields?: Array<{ name: string }> } | null
    }
  }
  const schema = data.__schema ?? {}
  return {
    queryFields: (schema.queryType?.fields ?? []).map((f) => f.name),
    mutationFields: (schema.mutationType?.fields ?? []).map((f) => f.name),
    subscriptionFields: (schema.subscriptionType?.fields ?? []).map((f) => f.name),
  }
}
