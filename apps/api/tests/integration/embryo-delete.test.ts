import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildApp } from "../../src/app.js";
import { create, findByIdIncludeDeleted } from "../../src/modules/embryo/embryo.repository.js";
import { signTestToken } from "../helpers/auth.js";

const MIGRATION_PATH = join(
  __dirname,
  "../../src/db/migrations/001_embryo_schema.sql",
);

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

const seedInput = {
  egg_donor: { age: 28, blood_type: "A+" as const, height: 165, eye_color: "brown" as const, hair_color: "dark_brown" as const },
  sperm_donor: { age: 33, blood_type: "O+" as const, height: 178, eye_color: "blue" as const, hair_color: "brown" as const },
  genetics: { screening_status: "passed" as const, chromosomal_abnormalities: false },
  medical: { quality_grade: "A" as const, development_stage: "blastocyst" as const, freeze_date: "2026-01-15" },
  media: { donor_photo_available: false },
};

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

const adminToken = signTestToken({ role: "admin", sub: "admin-1" }, "test-secret");
const coordToken = signTestToken({ role: "coordinator", sub: "coord-1" }, "test-secret");

describe("POST /api/v1/embryos/:id/delete — admin soft-delete", () => {
  it("admin soft-delete returns 204", async () => {
    const embryo = await create(sql, seedInput, "clinic-delete-test");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryo.id}/delete`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it("after soft-delete, donor fields are null (anonymized)", async () => {
    const embryo = await create(sql, seedInput, "clinic-delete-test");
    await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryo.id}/delete`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const rows = await sql<{ egg_donor_age: number | null }[]>`
      SELECT egg_donor_age FROM embryos WHERE id = ${embryo.id}
    `;
    expect(rows[0]!.egg_donor_age).toBeNull();
  });

  it("after soft-delete, medical fields are retained", async () => {
    const embryo = await create(sql, seedInput, "clinic-delete-test");
    await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryo.id}/delete`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const rows = await sql<{ medical_quality_grade: string }[]>`
      SELECT medical_quality_grade FROM embryos WHERE id = ${embryo.id}
    `;
    expect(rows[0]!.medical_quality_grade).toBe("A");
  });

  it("coordinator delete returns 403", async () => {
    const embryo = await create(sql, seedInput, "clinic-delete-test");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryo.id}/delete`,
      headers: { authorization: `Bearer ${coordToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("deleted record excluded from coordinator list", async () => {
    const embryo = await create(sql, seedInput, "clinic-deleted-exclusion");
    await app.inject({
      method: "POST",
      url: `/api/v1/embryos/${embryo.id}/delete`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos?clinic_id=clinic-deleted-exclusion",
      headers: { authorization: `Bearer ${coordToken}` },
    });
    const body = res.json() as unknown[];
    const ids = body.map((e) => (e as { id: string }).id);
    expect(ids).not.toContain(embryo.id);
  });
});
