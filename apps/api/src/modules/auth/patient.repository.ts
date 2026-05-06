import type postgres from "postgres";

export interface Patient {
  id: string;
  clinic_id: string;
  name: string | null;
  created_by: string;
  created_at: Date;
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
