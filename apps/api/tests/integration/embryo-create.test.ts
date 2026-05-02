import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { signTestToken } from "../helpers/auth.js";

const MIGRATION_PATH = join(
  __dirname,
  "../../src/db/migrations/001_embryo_schema.sql",
);

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());
  const migration = await readFile(MIGRATION_PATH, "utf8");
  await sql.unsafe(migration);
  app = await buildApp({ sql, jwtSecret: "test-secret" });
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

const coordToken = signTestToken({ role: "coordinator", sub: "coord-1", clinic_id: "clinic-create-test" }, "test-secret");

const validPayload = {
  egg_donor: { age: 30, blood_type: "A-", height: 168, eye_color: "hazel", hair_color: "light_brown" },
  sperm_donor: { age: 35, blood_type: "B+", height: 182, eye_color: "brown", hair_color: "black" },
  genetics: { screening_status: "passed", chromosomal_abnormalities: false },
  medical: { quality_grade: "B", development_stage: "expanded_blastocyst", freeze_date: "2026-02-20" },
  media: { donor_photo_available: true },
};

describe("POST /api/v1/embryos — create", () => {
  it("returns 201 with derived phenotype populated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.phenotype).toBeDefined();
    expect(body.phenotype.height_range).toBeDefined();
    expect(body.medical.quality_grade).toBe("B");
  });

  it("returned record has status = available by default", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    expect(res.json().status).toBe("available");
  });

  it("missing medical.quality_grade returns 400 with field details", async () => {
    const bad = structuredClone(validPayload) as Record<string, unknown>;
    delete (bad["medical"] as Record<string, unknown>)["quality_grade"];
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordToken}`, "content-type": "application/json" },
      body: JSON.stringify(bad),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("patient token returns 403", async () => {
    const patToken = signTestToken({ role: "patient", sub: "p-1" }, "test-secret");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${patToken}`, "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    expect(res.statusCode).toBe(403);
  });
});
