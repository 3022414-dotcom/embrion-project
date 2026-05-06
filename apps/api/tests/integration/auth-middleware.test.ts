import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { buildAuthHook } from "../../src/middleware/auth-hook.js";
import { requireRole } from "../../src/middleware/require-role.js";
import { signTestToken } from "../helpers/auth.js";

const MIGRATIONS = [
  join(__dirname, "../../src/db/migrations/001_embryo_schema.sql"),
  join(__dirname, "../../src/db/migrations/002_embryo_status_log.sql"),
  join(__dirname, "../../src/db/migrations/003_auth_schema.sql"),
];

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: ReturnType<typeof Fastify>;

const JWT_SECRET = "test-secret";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  // Build a custom test app (not buildApp) to test auth hooks in isolation
  app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  app.addHook("onRequest", buildAuthHook(sql));

  // Test routes that mirror the real permissions matrix
  app.get("/test/any", async (req) => ({ role: req.caller?.role ?? null }));
  app.post(
    "/test/coordinator-only",
    { preHandler: requireRole("coordinator", "admin") },
    async () => ({ ok: true }),
  );
  app.post(
    "/test/admin-only",
    { preHandler: requireRole("admin") },
    async () => ({ ok: true }),
  );

  await app.ready();
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("auth middleware — JWT coordinator", () => {
  it("valid coordinator JWT → 200, caller role is coordinator", async () => {
    const token = signTestToken(
      { role: "coordinator", sub: "coord-1", clinic_id: "clinic-a" },
      JWT_SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/test/any",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("coordinator");
  });

  it("expired JWT → 401", async () => {
    const token = signTestToken(
      {
        role: "coordinator",
        sub: "coord-1",
        clinic_id: "clinic-a",
        exp: Math.floor(Date.now() / 1000) - 3600,
      },
      JWT_SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/test/any",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("missing Authorization header → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/test/any" });
    expect(res.statusCode).toBe(401);
  });

  it("malformed token string → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test/any",
      headers: { authorization: "Bearer not.a.real.token" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("auth middleware — role enforcement", () => {
  it("patient opaque token on coordinator-only route → 403", async () => {
    const patResult = await sql<{ id: string }[]>`
      INSERT INTO patients (clinic_id, created_by) VALUES ('clinic-a', 'coord-1') RETURNING id
    `;
    const patientId = patResult[0]!.id;
    const selResult = await sql<{ id: string }[]>`
      INSERT INTO patient_selections (patient_id, clinic_id, created_by)
      VALUES (${patientId}, 'clinic-a', 'coord-1') RETURNING id
    `;
    const selectionId = selResult[0]!.id;
    const tokenValue = "d".repeat(64);
    const expiresAt = new Date(Date.now() + 86400_000);
    await sql`
      INSERT INTO access_tokens (token_value, patient_id, selection_id, clinic_id, expires_at, issued_by)
      VALUES (${tokenValue}, ${patientId}, ${selectionId}, 'clinic-a', ${expiresAt}, 'coord-1')
    `;

    const res = await app.inject({
      method: "POST",
      url: "/test/coordinator-only",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("coordinator token on admin-only route → 403", async () => {
    const token = signTestToken(
      { role: "coordinator", sub: "coord-1", clinic_id: "clinic-a" },
      JWT_SECRET,
    );
    const res = await app.inject({
      method: "POST",
      url: "/test/admin-only",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin token on admin-only route → 200", async () => {
    const token = signTestToken({ role: "admin", sub: "admin-1" }, JWT_SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/test/admin-only",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("SC-001 benchmark", () => {
  it("expired opaque token rejection < 100ms (single indexed DB query)", async () => {
    const patResult = await sql<{ id: string }[]>`
      INSERT INTO patients (clinic_id, created_by) VALUES ('clinic-perf', 'coord-perf') RETURNING id
    `;
    const patientId = patResult[0]!.id;
    const selResult = await sql<{ id: string }[]>`
      INSERT INTO patient_selections (patient_id, clinic_id, created_by)
      VALUES (${patientId}, 'clinic-perf', 'coord-perf') RETURNING id
    `;
    const selectionId = selResult[0]!.id;
    const tokenValue = "perf".repeat(16);
    const expiresAt = new Date(Date.now() - 1000);
    await sql`
      INSERT INTO access_tokens (token_value, patient_id, selection_id, clinic_id, expires_at, issued_by)
      VALUES (${tokenValue}, ${patientId}, ${selectionId}, 'clinic-perf', ${expiresAt}, 'coord-perf')
    `;

    const start = performance.now();
    const res = await app.inject({
      method: "GET",
      url: "/test/any",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    const elapsed = performance.now() - start;

    expect(res.statusCode).toBe(401);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("auth middleware — patient opaque token", () => {
  it("valid patient opaque token → 200, caller role is patient", async () => {
    const patResult = await sql<{ id: string }[]>`
      INSERT INTO patients (clinic_id, created_by) VALUES ('clinic-b', 'coord-2') RETURNING id
    `;
    const patientId = patResult[0]!.id;
    const selResult = await sql<{ id: string }[]>`
      INSERT INTO patient_selections (patient_id, clinic_id, created_by, embryo_ids)
      VALUES (${patientId}, 'clinic-b', 'coord-2', '{}') RETURNING id
    `;
    const selectionId = selResult[0]!.id;
    const tokenValue = "e".repeat(64);
    const expiresAt = new Date(Date.now() + 86400_000);
    await sql`
      INSERT INTO access_tokens (token_value, patient_id, selection_id, clinic_id, expires_at, issued_by)
      VALUES (${tokenValue}, ${patientId}, ${selectionId}, 'clinic-b', ${expiresAt}, 'coord-2')
    `;

    const res = await app.inject({
      method: "GET",
      url: "/test/any",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("patient");
  });

  it("expired opaque token → 401 with token_expired error", async () => {
    const patResult = await sql<{ id: string }[]>`
      INSERT INTO patients (clinic_id, created_by) VALUES ('clinic-c', 'coord-3') RETURNING id
    `;
    const patientId = patResult[0]!.id;
    const selResult = await sql<{ id: string }[]>`
      INSERT INTO patient_selections (patient_id, clinic_id, created_by)
      VALUES (${patientId}, 'clinic-c', 'coord-3') RETURNING id
    `;
    const selectionId = selResult[0]!.id;
    const tokenValue = "f".repeat(64);
    const expiresAt = new Date(Date.now() - 1000);
    await sql`
      INSERT INTO access_tokens (token_value, patient_id, selection_id, clinic_id, expires_at, issued_by)
      VALUES (${tokenValue}, ${patientId}, ${selectionId}, 'clinic-c', ${expiresAt}, 'coord-3')
    `;

    const res = await app.inject({
      method: "GET",
      url: "/test/any",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("token_expired");
  });
});
