import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures (Phase 10, ADR-025). Header format, modelled on common
 * payment providers:  `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "t.rawBody")>`.
 * The timestamp is inside the MAC, so a captured request cannot be replayed
 * after the tolerance window, and the event id makes replays inside it no-ops.
 */

export const SIGNATURE_HEADER = 'takawise-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, rawBody: string | Buffer, timestamp: number): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export type SignatureCheck = 'ok' | 'missing' | 'malformed' | 'stale' | 'mismatch';

export function verifySignature(args: {
  secret: string;
  rawBody: Buffer;
  header: string | undefined;
  nowSeconds: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  if (!args.header) return 'missing';
  const parts = new Map(
    args.header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const rawT = parts.get('t') ?? '';
  const v1 = parts.get('v1');
  if (!/^\d{1,12}$/.test(rawT) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return 'malformed';
  const t = Number.parseInt(rawT, 10);
  const tolerance = args.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const age = args.nowSeconds - t;
  if (age > tolerance || age < -tolerance) return 'stale';
  const expected = signPayload(args.secret, args.rawBody, t).slice(`t=${t},v1=`.length);
  const ok = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  return ok ? 'ok' : 'mismatch';
}

/** No 0/O/1/I: easy to read aloud and type from an e-mail. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 10 characters ≈ 50 bits; only an HMAC of it is stored. */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}
