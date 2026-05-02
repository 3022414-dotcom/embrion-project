import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { create } from "../../src/modules/embryo/embryo.repository.js";
import { signTestToken } from "../helpers/auth.js";

const MIGRATION_PATH = join(
  __dirname,
  "../../src/db/migrations/001_embryo_schema.sql",
);

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let embryoId: string;

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
  const migration = await readFile(MIGRATION_PATH, "utf8");
  await sql.unsafe(migration);
  app = await buildApp({ sql, jwtSecret: "test-secret" });
  const embryo = await create(sql, seedInput, "clinic-patient-test");
  embryoId = embryo.id;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("GET /api/v1/embryos/:id — patient projection", () => {
  it("does not contain id", async () => {
    const token = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty("id");
  });

  it("does not contain sex", async () => {
    const token = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body).not.toHaveProperty("sex");
  });

  it("does not contain chromosomal_abnormalities", async () => {
    const token = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body.genetics).not.toHaveProperty("chromosomal_abnormalities");
  });

  it("does not contain meta", async () => {
    const token = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body).not.toHaveProperty("meta");
  });

  it("retains screening_status", async () => {
    const token = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body.genetics.screening_status).toBe("passed");
  });
});

describe("Patient cannot change status", () => {
  it("returns 403 on PATCH status", async () => {
    const token = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/embryos/${embryoId}/status`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "reserved" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 on POST delete", async () => {
    const token = signTestToken({ role: "patient", sub: "patient-1" }, "test-secret");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryoId}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
