import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { signTestToken } from "../helpers/auth.js";

const MIGRATIONS = [
  join(__dirname, "../../src/db/migrations/001_embryo_schema.sql"),
  join(__dirname, "../../src/db/migrations/004_users.sql"),
];

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());
  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }
  app = await buildApp({ sql, jwtSecret: "test-secret" });
  // F-03: insert coordinator user so auth-hook is_active check passes
  await sql`
    INSERT INTO users (id, email, password_hash, role, clinic_id, is_active) VALUES
      ('coord-1', 'coord-1@clinic.test', 'test-hash', 'coordinator', 'clinic-val-test', true)
  `;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

const coordToken = signTestToken({ role: "coordinator", sub: "coord-1", clinic_id: "clinic-val-test" }, "test-secret");
const patientToken = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");

const validBody = {
  egg_donor: { age: 28, blood_type: "A+", height: 165, eye_color: "brown", hair_color: "dark_brown" },
  sperm_donor: { age: 32, blood_type: "O+", height: 178, eye_color: "blue", hair_color: "brown" },
  genetics: { screening_status: "passed", chromosomal_abnormalities: false },
  medical: { quality_grade: "A", development_stage: "blastocyst", freeze_date: "2026-01-15" },
  media: { donor_photo_available: false },
};

describe("POST /api/v1/embryos — validation", () => {
  it("valid payload returns 201 with derived phenotype", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.phenotype?.eye_color).toBe("brown");
    expect(body.phenotype?.hair_color).toBeDefined();
  });

  it("missing medical.quality_grade returns 400", async () => {
    const bad = structuredClone(validBody) as Record<string, unknown>;
    delete (bad["medical"] as Record<string, unknown>)["quality_grade"];
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify(bad),
    });
    expect(res.statusCode).toBe(400);
  });

  it("invalid blood_type returns 400", async () => {
    const bad = structuredClone(validBody);
    bad.egg_donor.blood_type = "X+" as unknown as "A+";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify(bad),
    });
    expect(res.statusCode).toBe(400);
  });

  it("patient JWT returns 401 (patient tokens are opaque, not JWTs)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${patientToken}`, "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.statusCode).toBe(401);
  });
});
