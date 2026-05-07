import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { create } from "../../src/modules/embryo/embryo.repository.js";
import { signTestToken } from "../helpers/auth.js";

const MIGRATIONS = [
  join(__dirname, "../../src/db/migrations/001_embryo_schema.sql"),
  join(__dirname, "../../src/db/migrations/002_embryo_status_log.sql"),
  join(__dirname, "../../src/db/migrations/004_users.sql"),
];

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

const seedInput = {
  egg_donor: { age: 26, blood_type: "O+" as const, height: 162, eye_color: "grey" as const, hair_color: "red" as const },
  sperm_donor: { age: 31, blood_type: "O-" as const, height: 175, eye_color: "grey" as const, hair_color: "blonde" as const },
  genetics: { screening_status: "passed" as const, chromosomal_abnormalities: false },
  medical: { quality_grade: "C" as const, development_stage: "morula" as const, freeze_date: "2026-03-01" },
  media: { donor_photo_available: false },
};

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
      ('coord-1', 'coord-1@clinic.test', 'test-hash', 'coordinator', 'default-clinic', true)
  `;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

const coordToken = signTestToken({ role: "coordinator", sub: "coord-1" }, "test-secret");
const patientToken = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");

describe("PATCH /api/v1/embryos/:id/status — coordinator transitions", () => {
  it("available → reserved succeeds", async () => {
    const embryo = await create(sql, seedInput, "clinic-status-test");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryo.id}/status`,
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "reserved" }),
    });
    expect(res.statusCode).toBe(200);
  });

  it("reserved → available succeeds (release)", async () => {
    const embryo = await create(sql, seedInput, "clinic-status-test");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryo.id}/status`,
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "reserved" }),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryo.id}/status`,
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "available" }),
    });
    expect(res.statusCode).toBe(200);
  });

  it("used → available returns 400 (terminal state)", async () => {
    const embryo = await create(sql, seedInput, "clinic-status-test");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryo.id}/status`,
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "used" }),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryo.id}/status`,
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "available" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("patient JWT returns 401 (patient tokens are opaque, not JWTs)", async () => {
    const embryo = await create(sql, seedInput, "clinic-status-test");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryo.id}/status`,
      headers: { authorization: `Bearer ${patientToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "reserved" }),
    });
    expect(res.statusCode).toBe(401);
  });
});
