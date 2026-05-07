import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

const COORD_ID = "rate-test-coord-1";
const COORD_EMAIL = "rate-coord@clinic.test";
const OTHER_EMAIL = "other-coord@clinic.test";
const OTHER_ID = "rate-test-coord-2";
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
      (${OTHER_ID}, ${OTHER_EMAIL}, ${hash}, 'coordinator', ${CLINIC_ID}, true)
  `;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

beforeEach(async () => {
  // Clear login attempts before each test for isolation
  await sql`DELETE FROM login_attempts WHERE email IN (${COORD_EMAIL}, ${OTHER_EMAIL})`;
});

describe("US3 — brute-force rate limiting", () => {
  it("5 failed attempts → 6th attempt returns 429", async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: COORD_EMAIL, password: "wrong-password" },
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json<{ error: string; retry_after_seconds: number }>();
    expect(body.error).toBe("Too many attempts");
    expect(typeof body.retry_after_seconds).toBe("number");
  });

  it("6th attempt with correct password is still 429 when rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: COORD_EMAIL, password: "wrong-password" },
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(429);
  });

  it("retry_after_seconds is a positive integer", async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: COORD_EMAIL, password: "wrong-password" },
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: "wrong-password" },
    });
    const body = res.json<{ retry_after_seconds: number }>();
    expect(Number.isInteger(body.retry_after_seconds)).toBe(true);
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });

  it("different email is unaffected by another email's failures", async () => {
    // Lock out COORD_EMAIL
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: COORD_EMAIL, password: "wrong-password" },
      });
    }

    // OTHER_EMAIL should still work
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: OTHER_EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });

  it("successful login resets the counter (fail×4, succeed×1, fail×1 → 200)", async () => {
    // 4 failures
    for (let i = 0; i < 4; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: COORD_EMAIL, password: "wrong-password" },
      });
    }

    // 1 success — resets counter
    const successRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: PASSWORD },
    });
    expect(successRes.statusCode).toBe(200);

    // 1 more failure — should be 401, not 429 (counter was reset)
    const failRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: "wrong-password" },
    });
    expect(failRes.statusCode).toBe(401);
  });

  it("429 body matches the expected schema", async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: COORD_EMAIL, password: "wrong-password" },
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: COORD_EMAIL, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body).toHaveProperty("error", "Too many attempts");
    expect(body).toHaveProperty("retry_after_seconds");
    expect(Object.keys(body)).toHaveLength(2);
  });
});
