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
  join(__dirname, "../../src/db/migrations/005_selection_opened_at.sql"),
];

const JWT_SECRET = "test-secret";

let sql: postgres.Sql;
let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let app: Awaited<ReturnType<typeof buildApp>>;

let embryoId: string;

const coordA = () =>
  signTestToken({ role: "coordinator", sub: "coord-a", clinic_id: "clinic-a" }, JWT_SECRET);

const embryoPayload = () => ({
  egg_donor: { age: 28, blood_type: "O+", height: 165, eye_color: "brown", hair_color: "brown" },
  sperm_donor: { age: 30, blood_type: "A+", height: 178, eye_color: "blue", hair_color: "blond" },
  genetics: { screening_status: "normal", chromosomal_abnormalities: false },
  medical: { quality_grade: "A", development_stage: "blastocyst", freeze_date: "2024-01-15" },
  media: { donor_photo_available: false },
});

/** Helper: create patient + selection with embryoId + issue a token. Returns { patientId, tokenValue }. */
async function setupPatientWithToken(): Promise<{ patientId: string; tokenValue: string }> {
  const patRes = await app.inject({
    method: "POST",
    url: "/api/v1/patients",
    headers: { authorization: `Bearer ${coordA()}` },
    payload: { name: "Test Patient" },
  });
  expect(patRes.statusCode).toBe(201);
  const patientId = patRes.json<{ id: string }>().id;

  await app.inject({
    method: "PATCH",
    url: `/api/v1/patients/${patientId}/selection`,
    headers: { authorization: `Bearer ${coordA()}` },
    payload: { embryo_ids: [embryoId] },
  });

  const tokenRes = await app.inject({
    method: "POST",
    url: `/api/v1/patients/${patientId}/token`,
    headers: { authorization: `Bearer ${coordA()}` },
    payload: { ttl_days: 30 },
  });
  expect(tokenRes.statusCode).toBe(201);
  const tokenValue = tokenRes.json<{ tokenValue: string }>().tokenValue;

  return { patientId, tokenValue };
}

/** Helper: get opened_at for a patient via coordinator. */
async function getOpenedAt(patientId: string): Promise<string | null> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/patients/${patientId}`,
    headers: { authorization: `Bearer ${coordA()}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ selection: { opened_at: string | null } | null }>().selection?.opened_at ?? null;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  sql = postgres(container.getConnectionUri());

  for (const path of MIGRATIONS) {
    const migration = await readFile(path, "utf8");
    await sql.unsafe(migration);
  }

  app = await buildApp({ sql, jwtSecret: JWT_SECRET });

  await sql`
    INSERT INTO users (id, email, password_hash, role, clinic_id, is_active) VALUES
      ('coord-a', 'coord-a@test.test', 'hash', 'coordinator', 'clinic-a', true)
  `;

  // Create one embryo in clinic-a for use in all tests
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/embryos",
    headers: { authorization: `Bearer ${coordA()}` },
    payload: embryoPayload(),
  });
  expect(res.statusCode).toBe(201);
  embryoId = res.json<{ id: string }>().id;
}, 90_000);

afterAll(async () => {
  await app.close();
  await sql.end();
  await container.stop();
});

describe("US3 — opened_at tracking", () => {
  it("(1) full roundtrip: GET /embryos with patient token sets opened_at", async () => {
    const { patientId, tokenValue } = await setupPatientWithToken();

    // Verify opened_at is null before first GET /embryos
    expect(await getOpenedAt(patientId)).toBeNull();

    // Patient opens the selection
    const embryoRes = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    expect(embryoRes.statusCode).toBe(200);

    // Coordinator sees opened_at set
    expect(await getOpenedAt(patientId)).not.toBeNull();
  });

  it("(2) before first GET /embryos → opened_at is null", async () => {
    const { patientId } = await setupPatientWithToken();
    expect(await getOpenedAt(patientId)).toBeNull();
  });

  it("(3) second GET /embryos → opened_at unchanged (not overwritten)", async () => {
    const { patientId, tokenValue } = await setupPatientWithToken();

    await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    const firstOpenedAt = await getOpenedAt(patientId);
    expect(firstOpenedAt).not.toBeNull();

    // Small delay to ensure NOW() would differ if update ran
    await new Promise((r) => setTimeout(r, 50));

    await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    const secondOpenedAt = await getOpenedAt(patientId);

    expect(secondOpenedAt).toBe(firstOpenedAt);
  });

  it("(4) GET /embryos/:id with patient token does NOT set opened_at", async () => {
    const { patientId, tokenValue } = await setupPatientWithToken();

    // Only call GET /embryos/:id, never GET /embryos
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/embryos/${embryoId}`,
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    expect(res.statusCode).toBe(200);

    // opened_at must remain null
    expect(await getOpenedAt(patientId)).toBeNull();
  });

  it("(5) expired token → 401, opened_at not set", async () => {
    const { patientId } = await setupPatientWithToken();

    // Insert an expired token directly
    const patRows = await sql<{ id: string }[]>`
      SELECT id FROM patient_selections WHERE patient_id = ${patientId}
    `;
    const selectionId = patRows[0]!.id;
    const expiredTokenValue = "exp" + "x".repeat(61);

    await sql`
      INSERT INTO access_tokens (token_value, patient_id, selection_id, clinic_id, expires_at, issued_by)
      VALUES (
        ${expiredTokenValue}, ${patientId}, ${selectionId}, 'clinic-a',
        NOW() - INTERVAL '1 second', 'coord-a'
      )
    `;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${expiredTokenValue}` },
    });
    expect(res.statusCode).toBe(401);

    // opened_at must remain null
    expect(await getOpenedAt(patientId)).toBeNull();
  });

  it("(6) PATCH selection after opening → opened_at unchanged", async () => {
    const { patientId, tokenValue } = await setupPatientWithToken();

    // Patient opens selection
    await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    const openedAt = await getOpenedAt(patientId);
    expect(openedAt).not.toBeNull();

    // Coordinator updates selection
    const anotherEmbryo = await app.inject({
      method: "POST",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${coordA()}` },
      payload: embryoPayload(),
    });
    const anotherEmbryoId = anotherEmbryo.json<{ id: string }>().id;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/patients/${patientId}/selection`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { embryo_ids: [embryoId, anotherEmbryoId] },
    });

    // opened_at must be unchanged
    expect(await getOpenedAt(patientId)).toBe(openedAt);
  });

  it("(7) POST /patients/:id/token (re-issue) → opened_at unchanged", async () => {
    const { patientId, tokenValue } = await setupPatientWithToken();

    // Patient opens selection
    await app.inject({
      method: "GET",
      url: "/api/v1/embryos",
      headers: { authorization: `Bearer ${tokenValue}` },
    });
    const openedAt = await getOpenedAt(patientId);
    expect(openedAt).not.toBeNull();

    // Coordinator re-issues token
    await app.inject({
      method: "POST",
      url: `/api/v1/patients/${patientId}/token`,
      headers: { authorization: `Bearer ${coordA()}` },
      payload: { ttl_days: 14 },
    });

    // opened_at must be unchanged
    expect(await getOpenedAt(patientId)).toBe(openedAt);
  });
});
