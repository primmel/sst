// twin/serve-signing.ts — the signed-serve envelope PRODUCER (spec
// §12's signed-serve posture; the OIML SMART platform's TODO.v3/10):
// an opt-in per-boot posture where every served quantity carries a
// device signature, so certification software can verify a serve
// genuinely came from the certified twin.
//
// THE WIRE CONTRACT is the smart platform's (the consumer owns it):
// the signed bytes are the DEEP-SORTED canonical JSON (no whitespace)
// of { endpoint, register, servedAt, value, unit? } — byte-identical
// to smart's browser/src/cnml/canonical-json.ts + the serve-envelope
// discipline (browser/src/crypto-provenance/serve-envelope.ts). The
// canonicalJson vectors in serve-signing.test.ts pin the byte
// compatibility; a drift on EITHER side fails loudly, never silently.
//
// CRYPTO IDIOM (a deliberate reconciliation — this repo had no crypto
// of its own): ECDSA P-256 / SHA-256 over WebCrypto
// (globalThis.crypto.subtle, Node ≥ 22), the DER-less r‖s signature
// base64url-encoded, keys as SPKI/PKCS8 base64url — exactly the smart
// side's sign-verify.ts substrate. One algorithm, one encoding, one
// canonicalization, two implementations pinned to the same vectors.
//
// THE EPISTEMIC WALL STANDS (law 1): the signature proves origin +
// integrity, NEVER physical truth — a lying twin (setFidelity) with a
// valid key still lies validly. Signing answers "whose value is this,
// and is it the same bytes the twin produced?" — never "is the value
// true?"
//
// CUSTODY: the twin holds its own pair; the private half never leaves
// the device. Sim packages MAY carry a committed pair (the package IS
// the device — a simulation custody, documented on the manifest
// block); a real deployment provisions the private half through
// SessionOptions, never through a committed package.

/** The canonical JSON (deep-sorted keys, no insignificant whitespace):
 *  reproducible by any verifier. Byte-compatible with the smart
 *  platform's canonicalJson — the serve-signing test pins the vectors. */
export function canonicalJson(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical)
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])]),
      )
    }
    return v
  }
  return JSON.stringify(canonical(value))
}

/** The covered content (the contract's set: value + servedAt +
 *  register + endpoint id). `register` is the twin's DECLARED aspect
 *  spelling — the twin signs what it declares; the deployment's
 *  binding coherence is the consumer's aspect check. */
export interface ServeEnvelopePayload {
  endpoint: string
  register: string
  value: unknown
  unit?: string
  /** Canonical ISO (toISOString form) — the twin's OWN serve time. */
  servedAt: string
}

/** The wire member riding the served payload as `signature` (snake_case,
 *  the data conventions). The covered endpoint + register ride inside
 *  so the envelope is self-describing; value/unit/servedAt are
 *  reconstructed from the serve itself by the verifier, never carried
 *  twice. */
export interface ServeEnvelopeSignatureWire {
  algorithm: 'ECDSA-P256-SHA256'
  key_id: string
  endpoint: string
  register: string
  public_key_spki?: string
  /** Base64url of the DER-less (r‖s) signature bytes. */
  signature: string
}

/** The canonical signed bytes (deep-sorted, no whitespace). */
export function canonicalServeEnvelope(p: ServeEnvelopePayload): string {
  const body: Record<string, unknown> = {
    endpoint: p.endpoint,
    register: p.register,
    servedAt: p.servedAt,
    value: p.value,
  }
  if (p.unit !== undefined) body['unit'] = p.unit
  return canonicalJson(body)
}

/** Base64url of raw bytes (the ONE encoding — the smart side's
 *  sign-verify.ts carries the identical pair). */
export function b64url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode base64url to raw bytes (the b64url mirror). */
export function unb64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const buf = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** The ONE algorithm configuration (ECDSA P-256 / SHA-256 — never a
 *  second dialect). */
export const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
export const ECDSA_P256_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

/** A twin's device signing pair (the private half never leaves the
 *  device — the boot holds it, the wire carries only the public copy). */
export interface ServeSigningKey {
  keyId: string
  privateKey: CryptoKey
  publicKeySpki: string
}

/** Generate one device signing pair (extractable: the caller provisions
 *  it — a package's committed sim key, a test's throwaway pair). */
export async function generateSigningKey(keyId: string): Promise<ServeSigningKey & { privateKeyPkcs8: string }> {
  const pair = await globalThis.crypto.subtle.generateKey(ECDSA_P256, true, ['sign', 'verify'])
  const spki = await globalThis.crypto.subtle.exportKey('spki', pair.publicKey)
  const pkcs8 = await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return { keyId, privateKey: pair.privateKey, publicKeySpki: b64url(spki), privateKeyPkcs8: b64url(pkcs8) }
}

/** Import a provisioned pair (the manifest/session declaration face). */
export async function importSigningKey(decl: {
  key_id: string
  public_key_spki: string
  private_key_pkcs8: string
}): Promise<ServeSigningKey> {
  const privateKey = await globalThis.crypto.subtle.importKey(
    'pkcs8', unb64url(decl.private_key_pkcs8), ECDSA_P256, false, ['sign'],
  )
  return { keyId: decl.key_id, privateKey, publicKeySpki: decl.public_key_spki }
}

/** Sign one serve at the twin boundary (the device-side act). */
export async function signServeEnvelope(
  payload: ServeEnvelopePayload,
  key: ServeSigningKey,
): Promise<ServeEnvelopeSignatureWire> {
  const data = new TextEncoder().encode(canonicalServeEnvelope(payload))
  const signature = await globalThis.crypto.subtle.sign(ECDSA_P256_SIGN, key.privateKey, data)
  return {
    algorithm: 'ECDSA-P256-SHA256',
    key_id: key.keyId,
    endpoint: payload.endpoint,
    register: payload.register,
    public_key_spki: key.publicKeySpki,
    signature: b64url(signature),
  }
}

export type ServeVerification = { ok: true } | { ok: false; reason: string }

/** Verify one signed serve (the consumer's act — the test suites and
 *  any local checker; the smart platform runs its OWN verifier over
 *  the same bytes). The failure names the field, never a bare false. */
export async function verifyServeEnvelope(
  payload: ServeEnvelopePayload,
  sig: ServeEnvelopeSignatureWire,
  publicKey: CryptoKey,
): Promise<ServeVerification> {
  if (sig.algorithm !== 'ECDSA-P256-SHA256') {
    return { ok: false, reason: `unknown signature algorithm "${sig.algorithm}" (expected ECDSA-P256-SHA256)` }
  }
  const data = new TextEncoder().encode(canonicalServeEnvelope(payload))
  try {
    const valid = await globalThis.crypto.subtle.verify(ECDSA_P256_SIGN, publicKey, unb64url(sig.signature), data)
    return valid
      ? { ok: true }
      : { ok: false, reason: `signature mismatch for endpoint ${payload.endpoint} register ${payload.register} at ${payload.servedAt} — the bytes are not what the twin signed` }
  } catch (e) {
    return { ok: false, reason: `verification fault for endpoint ${payload.endpoint} register ${payload.register}: ${(e as Error).message}` }
  }
}

/** Import a public key for verification (SPKI base64url). */
export async function importVerifyKey(spkiB64url: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('spki', unb64url(spkiB64url), ECDSA_P256, true, ['verify'])
}

// ── the session/manifest declaration faces ────────────────────────────

/** The signing declaration (the manifest block's + SessionOptions'
 *  snake_case face). Presence + activation = the twin signs; absence =
 *  the legacy unsigned face (the default). */
export interface ServeSigningDecl {
  /** The endpoint id the twin attests — the DEPLOYMENT's declared id
   *  for this twin (the consumer checks the attestation names the
   *  channel it consumes). */
  endpoint: string
  key_id: string
  public_key_spki: string
  private_key_pkcs8: string
  /** Per-serve-target aspect spelling overrides: the attested register
   *  is the twin's DECLARED aspect (the consumer's model spelling),
   *  which may differ from the internal serve target (the sampling
   *  line's sample_flow attests the R 144 aspect
   *  sample.test_context.flow). Default: the target spelled as-is. */
  registers?: Record<string, string>
}

/** The resolved signing posture (the runtime face): the device key
 *  imported, the endpoint + register spellings carried. */
export interface ServeSigning {
  endpoint: string
  key: ServeSigningKey
  registers: Record<string, string>
}

/** Resolve a declaration to the runtime posture (the key import is the
 *  async part). */
export async function resolveServeSigning(decl: ServeSigningDecl): Promise<ServeSigning> {
  return {
    endpoint: decl.endpoint,
    key: await importSigningKey(decl),
    registers: decl.registers ?? {},
  }
}

/** The env gate for MANIFEST-declared signing (the SIM_WORLD_TOKEN /
 *  SST_CORS_ORIGINS idiom): a committed `signing:` block activates only
 *  when the deployment opts in — `SST_SIGNED_SERVE=1` (or 'true').
 *  Programmatic SessionOptions declarations need no env (passing one
 *  IS the deployment act). */
export const SIGNED_SERVE_ENV = 'SST_SIGNED_SERVE'
export function signedServeEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[SIGNED_SERVE_ENV]
  return v === '1' || v === 'true'
}

// ── the serve-time wrapper ────────────────────────────────────────────

/** The raw quantity-reader face (what the kind/boot wiring produces
 *  today): value + unit + kind + servedAt in EPOCH SECONDS. */
export interface RawServedQuantity {
  value: number
  unit: string
  kind?: string
  servedAt?: number
}

/** Epoch seconds → the canonical ISO the signature covers AND the wire
 *  carries (the verifier reconstructs the coverage from the landed
 *  value — the signed string must BE the served string; the
 *  millisecond round is the float-noise guard). */
export function servedAtIso(epochSeconds: number): string {
  return new Date(Math.round(epochSeconds * 1000)).toISOString()
}

/** The signed serve shape (the signed posture's ServedQuantity wire):
 *  servedAt as canonical ISO + the signature member. */
export interface SignedServedQuantity {
  value: number
  unit: string
  kind: string
  servedAt: string
  signature: ServeEnvelopeSignatureWire
}

/** Wrap a raw quantity reader with the signing act: each read signs
 *  { endpoint, register (the declared aspect spelling), value, unit,
 *  servedAt } at serve time. ASYNC — the schema resolvers await it. */
export function signedQuantityReader(
  target: string,
  read: () => RawServedQuantity,
  signing: ServeSigning,
): () => Promise<SignedServedQuantity> {
  const register = signing.registers[target] ?? target
  return async () => {
    const raw = read()
    if (raw === null || typeof raw !== 'object' || typeof raw.value !== 'number' || typeof raw.unit !== 'string') {
      throw new Error(
        `signed serve '${target}': the register reader did not answer a served quantity (value+unit) — a signed serve signs a quantity, never an implicit shape`,
      )
    }
    const servedAt = servedAtIso(raw.servedAt ?? 0)
    const signature = await signServeEnvelope(
      { endpoint: signing.endpoint, register, value: raw.value, unit: raw.unit, servedAt },
      signing.key,
    )
    return {
      value: raw.value,
      unit: raw.unit,
      kind: raw.kind ?? 'quantity',
      servedAt,
      signature,
    }
  }
}
