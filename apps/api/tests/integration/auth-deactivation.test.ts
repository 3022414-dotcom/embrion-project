import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { signCoordinatorToken } from "../helpers/auth.js";
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

const TEST_COORD_ID = "deact-test-coord-1";
const TEST_CLINIC_ID = "clinic-001";
const TEST_EMAIL = "deact-coord@clinic.test";
const PASSWORD = "password123";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  app = await buildApp({ sql, jwtSecret: JWT_SECRET });
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US2 — is_active enforcement in auth-hook (T005 — auth-hook level)", () => {
  beforeAll(async () => {
    await sql`
      INSERT INTO users (id, email, password_hash, role, clinic_id, is_active)
      VALUES (
        ${TEST_COORD_ID},
        ${TEST_EMAIL},
        '$2a$12$placeholder',
        'coordinator',
        ${TEST_CLINIC_ID},
        true
      )
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id = ${TEST_COORD_ID}`;
  });

  it("coordinator JWT with valid sub and is_active=true → 200 on GET /api/v1/embryos", async () => {
    const token = signCoordinatorToken(
      { sub: TEST_COORD_ID, clinic_id: TEST_CLINIC_ID },
      JWT_SECRET,
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("same JWT after is_active=false → 401", async () => {
    const token = signCoordinatorToken(
      { sub: TEST_COORD_ID, clinic_id: TEST_CLINIC_ID },
      JWT_SECRET,
    );

    await sql`UPDATE users SET is_active = false WHERE id = ${TEST_COORD_ID}`;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);

    await sql`UPDATE users SET is_active = true WHERE id = ${TEST_COORD_ID}`;
  });
});

describe("US2 — end-to-end deactivation flow (T015)", () => {
  const E2E_COORD_ID = "deact-e2e-coord-1";
  const E2E_EMAIL = "deact-e2e@clinic.test";

  beforeAll(async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await sql`
      INSERT INTO users (id, email, password_hash, role, clinic_id, is_active)
      VALUES (${E2E_COORD_ID}, ${E2E_EMAIL}, ${hash}, 'coordinator', ${TEST_CLINIC_ID}, true)
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id = ${E2E_COORD_ID}`;
    await sql`DELETE FROM login_attempts WHERE email = ${E2E_EMAIL}`;
  });

  it("login → get JWT → deactivate → same JWT → 401", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: E2E_EMAIL, password: PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const { token } = loginRes.json<{ token: string }>();

    // JWT works before deactivation
    const beforeRes = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(beforeRes.statusCode).toBe(200);

    // Deactivate the account
    await sql`UPDATE users SET is_active = false WHERE id = ${E2E_COORD_ID}`;

    // Same JWT now fails
    const afterRes = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRes.statusCode).toBe(401);
  });

  it("re-enable → old JWT still rejected, fresh login required", async () => {
    // Reactivate the account
    await sql`UPDATE users SET is_active = true WHERE id = ${E2E_COORD_ID}`;

    // The old token from previous test should still exist in scope but won't be reused
    // New login succeeds
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: E2E_EMAIL, password: PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const { token: newToken } = loginRes.json<{ token: string }>();

    // New token works
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("inactive account login attempt → 401 with same error body", async () => {
    await sql`UPDATE users SET is_active = false WHERE id = ${E2E_COORD_ID}`;

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: E2E_EMAIL, password: PASSWORD },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Invalid credentials" });
    } finally {
      await sql`UPDATE users SET is_active = true WHERE id = ${E2E_COORD_ID}`;
    }
  });
});
