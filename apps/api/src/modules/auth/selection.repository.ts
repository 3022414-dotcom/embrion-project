import type postgres from "postgres";

export interface PatientSelection {
  id: string;
  patient_id: string;
  clinic_id: string;
  embryo_ids: string[];
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

function rowToSelection(row: Row): PatientSelection {
  return {
    id: row["id"] as string,
    patient_id: row["patient_id"] as string,
    clinic_id: row["clinic_id"] as string,
    embryo_ids: (row["embryo_ids"] as string[]) ?? [],
    created_by: row["created_by"] as string,
    created_at: row["created_at"] as Date,
    updated_at: row["updated_at"] as Date,
  };
}

export async function create(
  sql: Sql,
  input: { patientId: string; clinicId: string; createdBy: string },
): Promise<PatientSelection> {
  const rows = await sql<Row[]>`
    INSERT INTO patient_selections (patient_id, clinic_id, created_by)
    VALUES (${input.patientId}, ${input.clinicId}, ${input.createdBy})
    RETURNING *
  `;
  return rowToSelection(rows[0]!);
}

export async function findByPatientId(
  sql: Sql,
  patientId: string,
): Promise<PatientSelection | null> {
  const rows = await sql<Row[]>`
    SELECT * FROM patient_selections WHERE patient_id = ${patientId}
  `;
  return rows.length === 0 ? null : rowToSelection(rows[0]!);
}

export async function updateEmbryoIds(
  sql: Sql,
  patientId: string,
  embryoIds: string[],
  clinicId: string,
  updatedBy: string,
): Promise<PatientSelection> {
  if (embryoIds.length > 0) {
    const valid = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM embryos
      WHERE id = ANY(${sql.array(embryoIds, 2950)})
        AND clinic_id = ${clinicId}
        AND meta_deleted_at IS NULL
    `;
    if (Number(valid[0]!.count) !== embryoIds.length) {
      throw Object.assign(
        new Error("One or more embryo IDs not found in this clinic"),
        { statusCode: 400 },
      );
    }
  }

  const rows = await sql<Row[]>`
    INSERT INTO patient_selections (patient_id, clinic_id, embryo_ids, created_by)
    VALUES (${patientId}, ${clinicId}, ${sql.array(embryoIds, 2950)}, ${updatedBy})
    ON CONFLICT (patient_id) DO UPDATE SET
      embryo_ids = EXCLUDED.embryo_ids,
      updated_at = NOW()
    RETURNING *
  `;
  return rowToSelection(rows[0]!);
}
