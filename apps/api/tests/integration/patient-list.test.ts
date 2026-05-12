import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { signTestToken } from "../helpers/auth.js";

const MIGRATIONS = [
  join(__dirname, "../../src/db/migrations/001_embryo_schema.sql"),
  join(__dirname, "../../src/db/migrations/003_auth_schema.sql"),
  join(__dirname, "../../src/db/migrations/004_users.sql"),
  join(__dirname, "../../src/db/migrations/005_selection_opened_at.sql"),
];

const JWT_SECRET = "test-secret";

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

let embryoId: string;

const coordA = () =>
  signTestToken({ role: "coordinator", sub: "coord-a", clinic_id: "clinic-a" }, JWT_SECRET);
const coordB = () =>
  signTestToken({ role: "coordinator", sub: "coord-b", clinic_id: "clinic-b" }, JWT_SECRET);
const adminToken = () =>
  signTestToken({ role: "admin", sub: "admin-1" }, JWT_SECRET);

const embryoPayload = () => ({
  egg_donor: { age: 28, blood_type: "O+", height: 165, eye_color: "brown", hair_color: "brown" },
  sperm_donor: { age: 30, blood_type: "A+", height: 178, eye_color: "blue", hair_color: "blond" },
  genetics: { screening_status: "normal", chromosomal_abnormalities: false },
  medical: { quality_grade: "A", development_stage: "blastocyst", freeze_date: "2024-01-15" },
  media: { donor_photo_available: false },
});

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  app = await buildApp({ sql, jwtSecret: JWT_SECRET });

  await sql`
    INSERT INTO users (id, email, password_hash, role, clinic_id, is_active) VALUES
      ('coord-a', 'coord-a@test.test', 'hash', 'coordinator', 'clinic-a', true),
      ('coord-b', 'coord-b@test.test', 'hash', 'coordinator', 'clinic-b', true),
      ('admin-1', 'admin@test.test', 'hash', 'admin', null, true)
  `;

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/embryos",
    headers: { authorization: `Bearer ${coordA()}` },
    payload: embryoPayload(),
  });
  expect(res.statusCode).toBe(201);
  embryoId = res.json<{ id: string }>().id;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US1 — GET /api/v1/patients", () => {
  it("coordinator with patient with selection but no token → 200, selection.opened_at null, selection.token_expires_at null", async () => {
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { name: "Anna" },
    });
    expect(patRes.statusCode).toBe(201);
    const patientId = patRes.json<{ id: string }>().id;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/patients/${patientId}/selection`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { embryo_ids: [embryoId] },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(200);

    const list = res.json<Array<{ id: string; selection: { opened_at: unknown; token_expires_at: unknown } | null }>>();
    const found = list.find((p) => p.id === patientId);
    expect(found).toBeDefined();
    expect(found!.selection).not.toBeNull();
    expect(found!.selection!.opened_at).toBeNull();
    expect(found!.selection!.token_expires_at).toBeNull();
  });

  it("patient without selection → selection: null", async () => {
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: {},
    });
    expect(patRes.statusCode).toBe(201);
    const patientId = patRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(200);

    const list = res.json<Array<{ id: string; selection: unknown }>>();
    const found = list.find((p) => p.id === patientId);
    expect(found).toBeDefined();
    expect(found!.selection).toBeNull();
  });

  it("after issuing token → selection.token_expires_at not null", async () => {
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { name: "Token Patient" },
    });
    const patientId = patRes.json<{ id: string }>().id;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/patients/${patientId}/selection`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { embryo_ids: [embryoId] },
    });
    const tokenRes = await app.inject({
      method: "POST",
      url: `/api/v1/patients/${patientId}/token`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { ttl_days: 30 },
    });
    expect(tokenRes.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(200);

    const list = res.json<Array<{ id: string; selection: { token_expires_at: string | null } | null }>>();
    const found = list.find((p) => p.id === patientId);
    expect(found).toBeDefined();
    expect(found!.selection).not.toBeNull();
    expect(found!.selection!.token_expires_at).not.toBeNull();
  });

  it("coordinator of clinic-b cannot see patients of clinic-a", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordB()}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ clinic_id: string }>>();
    expect(list.every((p) => p.clinic_id === "clinic-b")).toBe(true);
  });

  it("clinic with 0 patients → empty array, not error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordB()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("admin without ?clinic_id= → 400 with error message", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("clinic_id is required for admin");
  });

  it("admin with ?clinic_id=clinic-a → list of clinic-a patients", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients?clinic_id=clinic-a",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ clinic_id: string }>>();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((p) => p.clinic_id === "clinic-a")).toBe(true);
  });

  it("request without authorization → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients",
    });
    expect(res.statusCode).toBe(401);
  });
});
