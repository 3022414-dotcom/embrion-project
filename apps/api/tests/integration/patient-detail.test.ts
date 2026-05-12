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

let embryoAId: string;
let embryoBId: string;

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

  const mkEmbryo = async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: embryoPayload(),
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  };

  embryoAId = await mkEmbryo();
  embryoBId = await mkEmbryo();
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US2 — GET /api/v1/patients/:id", () => {
  it("patient with 2-embryo selection → 200, embryo_ids.length === 2, opened_at null, token_expires_at null", async () => {
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { name: "Detail Patient" },
    });
    expect(patRes.statusCode).toBe(201);
    const patientId = patRes.json<{ id: string }>().id;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/patients/${patientId}/selection`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { embryo_ids: [embryoAId, embryoBId] },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/patients/${patientId}`,
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      id: string;
      selection: { embryo_ids: string[]; opened_at: unknown; token_expires_at: unknown } | null;
    }>();
    expect(body.id).toBe(patientId);
    expect(body.selection).not.toBeNull();
    expect(body.selection!.embryo_ids).toHaveLength(2);
    expect(body.selection!.embryo_ids).toContain(embryoAId);
    expect(body.selection!.embryo_ids).toContain(embryoBId);
    expect(body.selection!.opened_at).toBeNull();
    expect(body.selection!.token_expires_at).toBeNull();
  });

  it("after issuing token → token_expires_at not null", async () => {
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { name: "Token Detail Patient" },
    });
    const patientId = patRes.json<{ id: string }>().id;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/patients/${patientId}/selection`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { embryo_ids: [embryoAId] },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/patients/${patientId}/token`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { ttl_days: 30 },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/patients/${patientId}`,
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ selection: { token_expires_at: string | null } | null }>();
    expect(body.selection).not.toBeNull();
    expect(body.selection!.token_expires_at).not.toBeNull();
  });

  it("patient without selection → selection: null", async () => {
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: {},
    });
    const patientId = patRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/patients/${patientId}`,
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ selection: unknown }>();
    expect(body.selection).toBeNull();
  });

  it("patient from other clinic → 404", async () => {
    // Create patient in clinic-b
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordB()}` },
      payload: { name: "Clinic B Patient" },
    });
    expect(patRes.statusCode).toBe(201);
    const clinicBPatientId = patRes.json<{ id: string }>().id;

    // coord-a tries to get clinic-b patient → 404
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/patients/${clinicBPatientId}`,
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("non-existent id → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("admin can access patient from any clinic without clinic filter", async () => {
    const patRes = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { name: "Admin Visible Patient" },
    });
    const patientId = patRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/patients/${patientId}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }>().id).toBe(patientId);
  });

  it("request without authorization → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/patients/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(401);
  });
});
