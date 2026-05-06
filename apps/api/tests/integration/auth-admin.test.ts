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
];

const JWT_SECRET = "test-secret";

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

const adminToken = () => signTestToken({ role: "admin", sub: "admin-1" }, JWT_SECRET);
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

let embryoAId: string;
let embryoBId: string;
let patientBId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  app = await buildApp({ sql, jwtSecret: JWT_SECRET });

  // Create embryo in clinic-a
  const resA = await app.inject({
    method: "POST",
    url: "/api/v1/embryos",
    headers: { authorization: `Bearer ${coordA()}` },
    payload: embryoPayload(),
  });
  embryoAId = resA.json<{ id: string }>().id;

  // Create embryo in clinic-b
  const resB = await app.inject({
    method: "POST",
    url: "/api/v1/embryos",
    headers: { authorization: `Bearer ${coordB()}` },
    payload: embryoPayload(),
  });
  embryoBId = resB.json<{ id: string }>().id;

  // Create patient in clinic-b via admin (body clinic_id)
  const patRes = await app.inject({
    method: "POST",
    url: "/api/v1/patients",
    headers: { authorization: `Bearer ${adminToken()}` },
    payload: { clinic_id: "clinic-b" },
  });
  patientBId = patRes.json<{ id: string }>().id;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US3 — admin cross-clinic access", () => {
  it("admin GET /api/v1/embryos → embryos from both clinic fixtures returned", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ id: string }[]>().map((e) => e.id);
    expect(ids).toContain(embryoAId);
    expect(ids).toContain(embryoBId);
  });

  it("admin POST /api/v1/patients with clinic_id in body → 201, patient in specified clinic", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { clinic_id: "clinic-a", name: "Admin-created patient" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ clinic_id: string }>().clinic_id).toBe("clinic-a");
  });

  it("admin POST /api/v1/patients without clinic_id → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("admin DELETE /api/v1/patients/:id/token for patient in any clinic → 204 (idempotent)", async () => {
    // Create a selection and token for the patient first
    await app.inject({
      method: "PATCH",
      url: `/api/v1/patients/${patientBId}/selection`,
      headers: { authorization: `Bearer ${coordB()}` },
      payload: { embryo_ids: [] },
    });

    const tokenRes = await app.inject({
      method: "POST",
      url: `/api/v1/patients/${patientBId}/token`,
      headers: { authorization: `Bearer ${coordB()}` },
      payload: { ttl_days: 1 },
    });
    expect(tokenRes.statusCode).toBe(201);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/patients/${patientBId}/token`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it("coordinator DELETE /api/v1/patients/:id/token for patient in another clinic → 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/patients/${patientBId}/token`,
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("coordinator token on POST /api/v1/embryos/:id/delete → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryoAId}/delete`,
      headers: { authorization: `Bearer ${coordA()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin token on POST /api/v1/embryos/:id/delete → 204", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryoAId}/delete`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(204);
  });
});
