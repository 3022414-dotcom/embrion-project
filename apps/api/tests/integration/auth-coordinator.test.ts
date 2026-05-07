import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { signTestToken } from "../helpers/auth.js";

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

const coordA = () =>
  signTestToken({ role: "coordinator", sub: "coord-a", clinic_id: "clinic-a" }, JWT_SECRET);
const coordB = () =>
  signTestToken({ role: "coordinator", sub: "coord-b", clinic_id: "clinic-b" }, JWT_SECRET);

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

  // F-03: insert users so auth-hook is_active check passes
  await sql`
    INSERT INTO users (id, email, password_hash, role, clinic_id, is_active) VALUES
      ('coord-a', 'coord-a@clinic.test', 'test-hash', 'coordinator', 'clinic-a', true),
      ('coord-b', 'coord-b@clinic.test', 'test-hash', 'coordinator', 'clinic-b', true)
  `;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US2 — coordinator manages clinic data", () => {
  let embryoAId: string;
  let embryoBId: string;
  let patientId: string;

  it("POST /api/v1/embryos with coordinator JWT → 201, clinic_id stamped from JWT (not body)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { ...embryoPayload(), clinic_id: "should-be-ignored" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; clinic_id: string }>();
    embryoAId = body.id;
    expect(body.clinic_id).toBe("clinic-a");
  });

  it("GET /api/v1/embryos with coordinator JWT → returns only own clinic embryos", async () => {
    // Create an embryo in clinic-b
    const resB = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordB()}` },
      payload: embryoPayload(),
    });
    expect(resB.statusCode).toBe(201);
    embryoBId = resB.json<{ id: string }>().id;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ id: string }[]>().map((e) => e.id);
    expect(ids).toContain(embryoAId);
    expect(ids).not.toContain(embryoBId);
  });

  it("GET /api/v1/embryos/:id for embryo in another clinic → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoBId}`,
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/v1/patients with coordinator JWT → 201, patient has coordinator's clinic_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { name: "Test Patient" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; clinic_id: string }>();
    patientId = body.id;
    expect(body.clinic_id).toBe("clinic-a");
  });

  it("PATCH /api/v1/patients/:id/selection → sets embryo selection", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/patients/${patientId}/selection`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { embryo_ids: [embryoAId] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ embryo_ids: string[] }>();
    expect(body.embryo_ids).toContain(embryoAId);
  });

  it("POST /api/v1/patients/:id/token → issues token, then patient token works for selection", async () => {
    const tokenRes = await app.inject({
      method: "POST",
      url: `/api/v1/patients/${patientId}/token`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { ttl_days: 30 },
    });
    expect(tokenRes.statusCode).toBe(201);
    const { token_value } = tokenRes.json<{ token_value: string; expires_at: string }>();

    // Patient uses the token to access embryos
    const embryoRes = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token_value}` },
    });
    expect(embryoRes.statusCode).toBe(200);
    const ids = embryoRes.json<{ id: string }[]>().map((e) => e.id);
    expect(ids).toContain(embryoAId);
  });

  it("POST /api/v1/embryos with patient token → 403", async () => {
    // Issue a fresh token for the patient
    const tokenRes = await app.inject({
      method: "POST",
      url: `/api/v1/patients/${patientId}/token`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { ttl_days: 1 },
    });
    const { token_value } = tokenRes.json<{ token_value: string }>();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token_value}` },
      payload: embryoPayload(),
    });
    expect(res.statusCode).toBe(403);
  });
});
