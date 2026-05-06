import { createHmac } from "crypto";

function base64url(input: string | Buffer): string {
  const b = typeof input === "string" ? Buffer.from(input) : input;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function signTestToken(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const sig = base64url(
    createHmac("sha256", secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${sig}`;
}

/** Sign a coordinator JWT — clinic_id is required. */
export function signCoordinatorToken(
  opts: { sub: string; clinic_id: string },
  secret: string,
): string {
  return signTestToken({ role: "coordinator", sub: opts.sub, clinic_id: opts.clinic_id }, secret);
}

/** Sign an admin JWT — no clinic_id. */
export function signAdminToken(opts: { sub: string }, secret: string): string {
  return signTestToken({ role: "admin", sub: opts.sub }, secret);
}
