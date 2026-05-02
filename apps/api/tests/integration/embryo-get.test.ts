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
    age: 29,
    blood_type: "A+" as const,
    height: 168,
    eye_color: "hazel" as const,
    hair_color: "brown" as const,
  },
  sperm_donor: {
    age: 35,
    blood_type: "B+" as const,
    height: 180,
    eye_color: "blue" as const,
    hair_color: "dark_brown" as const,
  },
  genetics: {
    screening_status: "passed" as const,
    chromosomal_abnormalities: false,
    risk_factors: [{ name: "CF carrier", severity: "low" as const }],
  },
  medical: {
    quality_grade: "B" as const,
    development_stage: "blastocyst" as const,
    freeze_date: "2026-02-10",
  },
  media: {
    donor_photo_available: true,
  },
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());
  const migration = await readFile(MIGRATION_PATH, "utf8");
  await sql.unsafe(migration);

  app = await buildApp({ sql, jwtSecret: "test-secret" });

  const embryo = await create(sql, seedInput, "clinic-001");
  embryoId = embryo.id;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("GET /api/v1/embryos/:id — coordinator", () => {
  it("returns 200 with full record for coordinator", async () => {
    const token = signTestToken({ role: "coordinator", sub: "coord-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(embryoId);
    expect(body.sex).toBeUndefined(); // not set in seed
    expect(body.genetics.chromosomal_abnormalities).toBe(false);
    expect(body.genetics.risk_factors).toHaveLength(1);
    expect(body.meta.schema_version).toBe("1.0.0");
  });

  it("returns 404 for non-existent id", async () => {
    const token = signTestToken({ role: "coordinator", sub: "coord-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/v1/embryos — coordinator list", () => {
  it("returns array of records", async () => {
    const token = signTestToken({ role: "coordinator", sub: "coord-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/schema/manifest", () => {
  it("returns current schema version", async () => {
    const token = signTestToken({ role: "coordinator", sub: "coord-1" }, "test-secret");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/schema/manifest",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current_version).toBe("1.0.0");
    expect(Array.isArray(body.changelog)).toBe(true);
  });
});
