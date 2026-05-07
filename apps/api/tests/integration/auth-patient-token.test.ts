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
  join(__dirname, "../../src/db/migrations/004_users.sql"),
];

const JWT_SECRET = "test-secret";

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

/** IDs created during setup */
let embryoAId: string;
let embryoBId: string;
let embryoCId: string;
let patientId: string;
let selectionId: string;

const COORDINATOR_TOKEN = () =>
  signTestToken({ role: "coordinator", sub: "coord-1", clinic_id: "clinic-a" }, JWT_SECRET);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  app = await buildApp({ sql, jwtSecret: JWT_SECRET });

  // F-03: insert coordinator user so auth-hook is_active check passes
  await sql`
    INSERT INTO users (id, email, password_hash, role, clinic_id, is_active) VALUES
      ('coord-1', 'coord-1@clinic.test', 'test-hash', 'coordinator', 'clinic-a', true)
  `;

  // Create 3 embryos in clinic-a via the API
  const mkEmbryo = async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${COORDINATOR_TOKEN()}` },
      payload: {
        egg_donor: { age: 28, blood_type: "O+", height: 165, eye_color: "brown", hair_color: "brown" },
        sperm_donor: { age: 30, blood_type: "A+", height: 178, eye_color: "blue", hair_color: "blond" },
        genetics: { screening_status: "normal", chromosomal_abnormalities: false },
        medical: { quality_grade: "A", development_stage: "blastocyst", freeze_date: "2024-01-15" },
        media: { donor_photo_available: false },
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  };

  embryoAId = await mkEmbryo();
  embryoBId = await mkEmbryo();
  embryoCId = await mkEmbryo();

  // Create patient + selection that contains only A and B
  const patRes = await sql<{ id: string }[]>`
    INSERT INTO patients (clinic_id, created_by) VALUES ('clinic-a', 'coord-1') RETURNING id
  `;
  patientId = patRes[0]!.id;

  const selRes = await sql<{ id: string }[]>`
    INSERT INTO patient_selections (patient_id, clinic_id, embryo_ids, created_by)
    VALUES (${patientId}, 'clinic-a', ${sql.array([embryoAId, embryoBId], 2950)}, 'coord-1')
    RETURNING id
  `;
  selectionId = selRes[0]!.id;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US1 — patient token access", () => {
  const makeToken = async (expiresAt: Date, tokenValue: string) => {
    await sql`
      INSERT INTO access_tokens (token_value, patient_id, selection_id, clinic_id, expires_at, issued_by)
      VALUES (${tokenValue}, ${patientId}, ${selectionId}, 'clinic-a', ${expiresAt}, 'coord-1')
    `;
    return tokenValue;
  };

  it("valid patient token → GET /api/v1/embryos returns only selection embryos", async () => {
    const token = await makeToken(new Date(Date.now() + 86400_000), "a".repeat(64));

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ id: string }[]>();
    const ids = body.map((e) => e.id).sort();
    expect(ids).toEqual([embryoAId, embryoBId].sort());
    expect(ids).not.toContain(embryoCId);
  });

  it("GET /api/v1/embryos/:id for embryo in selection → 200, sex field absent (patient projection)", async () => {
    const token = "a".repeat(64); // reuse active token from first test

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoAId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.id).toBe(embryoAId);
    expect(body.sex).toBeUndefined();
  });

  it("GET /api/v1/embryos/:id for embryo NOT in selection → 404", async () => {
    const token = "a".repeat(64);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoCId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("expired patient token → 401 with token_expired error", async () => {
    const token = await makeToken(new Date(Date.now() - 1000), "b".repeat(64));

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe("token_expired");
  });

  it("revoked patient token → 401", async () => {
    const token = await makeToken(new Date(Date.now() + 86400_000), "c".repeat(64));
    await sql`
      UPDATE access_tokens SET revoked_at = NOW(), revoked_by = 'coord-1'
      WHERE token_value = ${token}
    `;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("same valid patient token used twice → both 200 (multi-use)", async () => {
    const token = "a".repeat(64); // active token from first test

    const [r1, r2] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/embryos", headers: { authorization: `Bearer ${token}` } }),
      app.inject({ method: "GET", url: "/api/v1/embryos", headers: { authorization: `Bearer ${token}` } }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
  });
});
