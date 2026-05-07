import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import bcrypt from "bcryptjs";

const MIGRATIONS = [
  join(__dirname, "../../src/db/migrations/001_embryo_schema.sql"),
  join(__dirname, "../../src/db/migrations/002_embryo_status_log.sql"),
  join(__dirname, "../../src/db/migrations/003_auth_schema.sql"),
  join(__dirname, "../../src/db/migrations/004_users.sql"),
];

const JWT_SECRET = "test-secret";

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

const COORD_ID = "login-test-coord-1";
const ADMIN_ID = "login-test-admin-1";
const COORD_EMAIL = "coordinator@clinic.test";
const ADMIN_EMAIL = "admin@clinic.test";
const PASSWORD = "password123";
const CLINIC_ID = "clinic-001";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  app = await buildApp({ sql, jwtSecret: JWT_SECRET });

  const hash = await bcrypt.hash(PASSWORD, 4);
  await sql`
    INSERT INTO users (id, email, password_hash, role, clinic_id, is_active)
    VALUES
      (${COORD_ID}, ${COORD_EMAIL}, ${hash}, 'coordinator', ${CLINIC_ID}, true),
      (${ADMIN_ID}, ${ADMIN_EMAIL}, ${hash}, 'admin', NULL, true)
  `;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US1 — POST /api/v1/auth/login", () => {
  it("coordinator login → 200 with token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string }>();
    expect(body.token).toBeTruthy();
    expect(typeof body.token).toBe("string");
  });

  it("coordinator token contains correct claims (role, clinic_id)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: PASSWORD },
    });
    const { token } = res.json<{ token: string }>();

    // Decode JWT payload (base64url middle segment)
    const payloadB64 = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

    expect(payload.sub).toBe(COORD_ID);
    expect(payload.role).toBe("coordinator");
    expect(payload.clinic_id).toBe(CLINIC_ID);
  });

  it("admin login → 200, token has no clinic_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ADMIN_EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json<{ token: string }>();

    const payloadB64 = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

    expect(payload.role).toBe("admin");
    expect(payload.clinic_id).toBeUndefined();
  });

  it("JWT exp claim is approximately 8 hours from iat", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: PASSWORD },
    });
    const { token } = res.json<{ token: string }>();
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

    const ttlSeconds = payload.exp - payload.iat;
    expect(ttlSeconds).toBe(8 * 60 * 60); // exactly 8 hours
  });

  it("coordinator JWT accepted by GET /api/v1/embryos → 200", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: PASSWORD },
    });
    const { token } = loginRes.json<{ token: string }>();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("wrong password → 401 with { error: 'Invalid credentials' }", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid credentials" });
  });

  it("unknown email → 401 with same error body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "unknown@clinic.test", password: PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid credentials" });
  });

  it("inactive account → 401 with same error body", async () => {
    await sql`UPDATE users SET is_active = false WHERE id = ${COORD_ID}`;

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: COORD_EMAIL, password: PASSWORD },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Invalid credentials" });
    } finally {
      await sql`UPDATE users SET is_active = true WHERE id = ${COORD_ID}`;
    }
  });

  it("missing email field → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });

  it("missing password field → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL },
    });
    expect(res.statusCode).toBe(400);
  });
});
