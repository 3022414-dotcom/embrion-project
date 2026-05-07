import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { create } from "../../src/modules/embryo/embryo.repository.js";
import { signCoordinatorToken } from "../helpers/auth.js";
import bcrypt from "bcryptjs";

const MIGRATIONS = [
  join(__dirname, "../../src/db/migrations/001_embryo_schema.sql"),
  join(__dirname, "../../src/db/migrations/002_embryo_status_log.sql"),
  join(__dirname, "../../src/db/migrations/003_auth_schema.sql"),
  join(__dirname, "../../src/db/migrations/004_users.sql"),
];

const JWT_SECRET = "test-secret";
const COORD_ID = "proj-test-coord-1";
const CLINIC_ID = "clinic-patient-test";

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let embryoId: string;
let patientToken: string;

const seedInput = {
  egg_donor: {
    age: 27,
    blood_type: "B+" as const,
    height: 160,
    eye_color: "blue" as const,
    hair_color: "blonde" as const,
  },
  sperm_donor: {
    age: 34,
    blood_type: "A-" as const,
    height: 177,
    eye_color: "brown" as const,
    hair_color: "dark_brown" as const,
  },
  genetics: {
    screening_status: "passed" as const,
    chromosomal_abnormalities: false,
    risk_factors: [{ name: "carrier", severity: "low" as const }],
  },
  medical: {
    quality_grade: "A" as const,
    development_stage: "blastocyst" as const,
    freeze_date: "2026-03-10",
  },
  media: {
    donor_photo_available: false,
  },
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  app = await buildApp({ sql, jwtSecret: JWT_SECRET });

  // Create coordinator user so auth-hook is_active check passes
  const hash = await bcrypt.hash("password123", 4);
  await sql`
    INSERT INTO users (id, email, password_hash, role, clinic_id, is_active)
    VALUES (${COORD_ID}, 'proj-coord@clinic.test', ${hash}, 'coordinator', ${CLINIC_ID}, true)
  `;

  // Create embryo via direct SQL (repository) — no auth needed
  const embryo = await create(sql, seedInput, CLINIC_ID);
  embryoId = embryo.id;

  const coordToken = signCoordinatorToken({ sub: COORD_ID, clinic_id: CLINIC_ID }, JWT_SECRET);

  // Create patient via coordinator API
  const patientRes = await app.inject({
    method: "POST",
    url: "/api/v1/patients",
    headers: { authorization: `Bearer ${coordToken}` },
    payload: { name: "Test Patient" },
  });
  const patient = patientRes.json<{ id: string }>();

  // Set embryo selection
  await app.inject({
    method: "PATCH",
    url: `/api/v1/patients/${patient.id}/selection`,
    headers: { authorization: `Bearer ${coordToken}` },
    payload: { embryo_ids: [embryoId] },
  });

  // Issue patient token
  const tokenRes = await app.inject({
    method: "POST",
    url: `/api/v1/patients/${patient.id}/token`,
    headers: { authorization: `Bearer ${coordToken}` },
    payload: { ttl_days: 30 },
  });
  patientToken = tokenRes.json<{ token_value: string }>().token_value;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("GET /api/v1/embryos/:id — patient projection", () => {
  it("does not contain id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty("id");
  });

  it("does not contain sex", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    const body = res.json();
    expect(body).not.toHaveProperty("sex");
  });

  it("does not contain chromosomal_abnormalities", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    const body = res.json();
    expect(body.genetics).not.toHaveProperty("chromosomal_abnormalities");
  });

  it("does not contain meta", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    const body = res.json();
    expect(body).not.toHaveProperty("meta");
  });

  it("retains screening_status", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    const body = res.json();
    expect(body.genetics.screening_status).toBe("passed");
  });
});

describe("Patient cannot change status", () => {
  it("returns 403 on PATCH status", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryoId}/status`,
      headers: { authorization: `Bearer ${patientToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "reserved" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 on POST delete", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryoId}/delete`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
