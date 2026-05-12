import type postgres from "postgres";

export interface Patient {
  id: string;
  clinic_id: string;
  name: string | null;
  created_by: string;
  created_at: Date;
}

export interface PatientListItem {
  id: string;
  name: string | null;
  clinic_id: string;
  created_at: Date;
  selection: {
    opened_at: Date | null;
    token_expires_at: Date | null;
  } | null;
}

export interface PatientDetail {
  id: string;
  name: string | null;
  clinic_id: string;
  created_at: Date;
  selection: {
    embryo_ids: string[];
    opened_at: Date | null;
    token_expires_at: Date | null;
  } | null;
}

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

function rowToPatient(row: Row): Patient {
  return {
    id: row["id"] as string,
    clinic_id: row["clinic_id"] as string,
    name: (row["name"] as string | null) ?? null,
    created_by: row["created_by"] as string,
    created_at: row["created_at"] as Date,
  };
}

export async function create(
  sql: Sql,
  input: { clinicId: string; name?: string; createdBy: string },
): Promise<Patient> {
  const rows = await sql<Row[]>`
    INSERT INTO patients (clinic_id, name, created_by)
    VALUES (${input.clinicId}, ${input.name ?? null}, ${input.createdBy})
    RETURNING *
  `;
  return rowToPatient(rows[0]!);
}

export async function findById(
  sql: Sql,
  id: string,
  clinicId?: string,
): Promise<Patient | null> {
  const rows = clinicId
    ? await sql<Row[]>`SELECT * FROM patients WHERE id = ${id} AND clinic_id = ${clinicId}`
    : await sql<Row[]>`SELECT * FROM patients WHERE id = ${id}`;
  return rows.length === 0 ? null : rowToPatient(rows[0]!);
}

export async function findByClinic(sql: Sql, clinicId: string): Promise<Patient[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM patients WHERE clinic_id = ${clinicId} ORDER BY created_at DESC
  `;
  return rows.map(rowToPatient);
}

function rowToPatientListItem(row: Row): PatientListItem {
  const hasSelection = row["has_selection"] as boolean;
  return {
    id: row["id"] as string,
    name: (row["name"] as string | null) ?? null,
    clinic_id: row["clinic_id"] as string,
    created_at: row["created_at"] as Date,
    selection: hasSelection
      ? {
          opened_at: (row["opened_at"] as Date | null) ?? null,
          token_expires_at: (row["token_expires_at"] as Date | null) ?? null,
        }
      : null,
  };
}

function rowToPatientDetail(row: Row): PatientDetail {
  const hasSelection = row["has_selection"] as boolean;
  return {
    id: row["id"] as string,
    name: (row["name"] as string | null) ?? null,
    clinic_id: row["clinic_id"] as string,
    created_at: row["created_at"] as Date,
    selection: hasSelection
      ? {
          embryo_ids: (row["embryo_ids"] as string[]) ?? [],
          opened_at: (row["opened_at"] as Date | null) ?? null,
          token_expires_at: (row["token_expires_at"] as Date | null) ?? null,
        }
      : null,
  };
}

export async function findEnrichedByClinic(
  sql: Sql,
  clinicId: string,
): Promise<PatientListItem[]> {
  const rows = await sql<Row[]>`
    SELECT
      p.id, p.name, p.clinic_id, p.created_at,
      ps.opened_at,
      (
        SELECT at.expires_at
        FROM access_tokens at
        WHERE at.patient_id = p.id
          AND at.revoked_at IS NULL
          AND at.expires_at > NOW()
        LIMIT 1
      ) AS token_expires_at,
      (ps.id IS NOT NULL) AS has_selection
    FROM patients p
    LEFT JOIN patient_selections ps ON ps.patient_id = p.id
    WHERE p.clinic_id = ${clinicId}
    ORDER BY p.created_at DESC
  `;
  return rows.map(rowToPatientListItem);
}

export async function findEnrichedById(
  sql: Sql,
  id: string,
  clinicId?: string,
): Promise<PatientDetail | null> {
  const rows = clinicId
    ? await sql<Row[]>`
        SELECT
          p.id, p.name, p.clinic_id, p.created_at,
          ps.opened_at, ps.embryo_ids,
          (
            SELECT at.expires_at
            FROM access_tokens at
            WHERE at.patient_id = p.id
              AND at.revoked_at IS NULL
              AND at.expires_at > NOW()
            LIMIT 1
          ) AS token_expires_at,
          (ps.id IS NOT NULL) AS has_selection
        FROM patients p
        LEFT JOIN patient_selections ps ON ps.patient_id = p.id
        WHERE p.id = ${id} AND p.clinic_id = ${clinicId}
      `
    : await sql<Row[]>`
        SELECT
          p.id, p.name, p.clinic_id, p.created_at,
          ps.opened_at, ps.embryo_ids,
          (
            SELECT at.expires_at
            FROM access_tokens at
            WHERE at.patient_id = p.id
              AND at.revoked_at IS NULL
              AND at.expires_at > NOW()
            LIMIT 1
          ) AS token_expires_at,
          (ps.id IS NOT NULL) AS has_selection
        FROM patients p
        LEFT JOIN patient_selections ps ON ps.patient_id = p.id
        WHERE p.id = ${id}
      `;
  return rows.length === 0 ? null : rowToPatientDetail(rows[0]!);
}
