import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { readFile } from "fs/promises";
import { join } from "path";
import { findById, findAll, create } from "../../src/modules/embryo/embryo.repository.js";

const MIGRATION_PATH = join(
  __dirname,
  "../../src/db/migrations/001_embryo_schema.sql",
);

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());
  const migration = await readFile(MIGRATION_PATH, "utf8");
  await sql.unsafe(migration);
}, 60_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

const seedInput = {
  egg_donor: {
    age: 28,
    blood_type: "A+" as const,
    height: 165,
    eye_color: "brown" as const,
    hair_color: "dark_brown" as const,
  },
  sperm_donor: {
    age: 32,
    blood_type: "O+" as const,
    height: 178,
    eye_color: "blue" as const,
    hair_color: "brown" as const,
  },
  genetics: {
    screening_status: "passed" as const,
    chromosomal_abnormalities: false,
  },
  medical: {
    quality_grade: "A" as const,
    development_stage: "blastocyst" as const,
    freeze_date: "2026-01-15",
  },
  media: {
    donor_photo_available: false,
  },
};

describe("embryo.repository — create", () => {
  it("inserts a record and returns it with id", async () => {
    const embryo = await create(sql, seedInput, "clinic-001");
    expect(embryo.id).toBeDefined();
    expect(embryo.status).toBe("available");
    expect(embryo.egg_donor.age).toBe(28);
  });

  it("derives phenotype on create", async () => {
    const embryo = await create(sql, seedInput, "clinic-001");
    expect(embryo.phenotype?.eye_color).toBe("brown");
    expect(embryo.phenotype?.hair_color).toBe("dark_brown");
    expect(embryo.phenotype?.height_range).toBeTruthy();
  });
});

describe("embryo.repository — findById", () => {
  it("returns null for unknown id", async () => {
    const result = await findById(sql, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("returns full record for known id", async () => {
    const created = await create(sql, seedInput, "clinic-001");
    const found = await findById(sql, created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });
});

describe("embryo.repository — findAll", () => {
  it("filters by clinic_id", async () => {
    await create(sql, seedInput, "clinic-filter-test");
    const results = await findAll(sql, { clinic_id: "clinic-filter-test" });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((e) => expect(e.clinic_id).toBe("clinic-filter-test"));
  });
});
