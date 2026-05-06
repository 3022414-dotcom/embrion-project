import type postgres from "postgres";

export interface AccessToken {
  id: string;
  token_value: string;
  patient_id: string;
  selection_id: string;
  clinic_id: string;
  expires_at: Date;
  issued_by: string;
  issued_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
}

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

function rowToToken(row: Row): AccessToken {
  return {
    id: row["id"] as string,
    token_value: row["token_value"] as string,
    patient_id: row["patient_id"] as string,
    selection_id: row["selection_id"] as string,
    clinic_id: row["clinic_id"] as string,
    expires_at: row["expires_at"] as Date,
    issued_by: row["issued_by"] as string,
    issued_at: row["issued_at"] as Date,
    revoked_at: (row["revoked_at"] as Date | null) ?? null,
    revoked_by: (row["revoked_by"] as string | null) ?? null,
  };
}

export async function create(
  sql: Sql,
  input: {
    tokenValue: string;
    patientId: string;
    selectionId: string;
    clinicId: string;
    expiresAt: Date;
    issuedBy: string;
  },
): Promise<AccessToken> {
  const rows = await sql<Row[]>`
    INSERT INTO access_tokens
      (token_value, patient_id, selection_id, clinic_id, expires_at, issued_by)
    VALUES
      (${input.tokenValue}, ${input.patientId}, ${input.selectionId},
       ${input.clinicId}, ${input.expiresAt}, ${input.issuedBy})
    RETURNING *
  `;
  return rowToToken(rows[0]!);
}

export async function findActive(
  sql: Sql,
  tokenValue: string,
): Promise<{ token: AccessToken; embryoIds: string[] } | null> {
  const rows = await sql<Row[]>`
    SELECT
      at.id, at.token_value, at.patient_id, at.selection_id, at.clinic_id,
      at.expires_at, at.issued_by, at.issued_at, at.revoked_at, at.revoked_by,
      ps.embryo_ids
    FROM access_tokens at
    JOIN patient_selections ps ON at.selection_id = ps.id
    WHERE at.token_value = ${tokenValue}
      AND at.revoked_at IS NULL
      AND at.expires_at > NOW()
  `;
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    token: rowToToken(row),
    embryoIds: (row["embryo_ids"] as string[]) ?? [],
  };
}

export async function findByTokenValue(
  sql: Sql,
  tokenValue: string,
): Promise<AccessToken | null> {
  const rows = await sql<Row[]>`
    SELECT * FROM access_tokens WHERE token_value = ${tokenValue}
  `;
  return rows.length === 0 ? null : rowToToken(rows[0]!);
}

export async function revokeByPatientId(
  sql: Sql,
  patientId: string,
  revokedBy: string,
): Promise<void> {
  await sql`
    UPDATE access_tokens
    SET revoked_at = NOW(), revoked_by = ${revokedBy}
    WHERE patient_id = ${patientId} AND revoked_at IS NULL
  `;
}
