import type postgres from "postgres";
import { EmbryoSchema, CreateEmbryoSchema } from "@embrion/schema";
import type { Embryo } from "@embrion/schema";
import { z } from "zod";

type Sql = postgres.Sql;
type EmbryoRow = Record<string, unknown>;

function rowToEmbryo(row: EmbryoRow): Embryo {
  const isAnonymized = row["egg_donor_age"] == null;

  const egg_donor = isAnonymized
    ? {
        age: 0,
        blood_type: "O+" as const,
        height: 140,
        eye_color: "other" as const,
        hair_color: "other" as const,
      }
    : {
        age: Number(row["egg_donor_age"]),
        blood_type: row["egg_donor_blood_type"] as Embryo["egg_donor"]["blood_type"],
        height: Number(row["egg_donor_height"]),
        eye_color: row["egg_donor_eye_color"] as Embryo["egg_donor"]["eye_color"],
        hair_color: row["egg_donor_hair_color"] as Embryo["egg_donor"]["hair_color"],
        ...(row["egg_donor_education"] != null ? { education: String(row["egg_donor_education"]) } : {}),
        ...(row["egg_donor_ethnicity"] != null ? { ethnicity: String(row["egg_donor_ethnicity"]) } : {}),
      };

  const sperm_donor = isAnonymized
    ? {
        age: 0,
        blood_type: "O+" as const,
        height: 140,
        eye_color: "other" as const,
        hair_color: "other" as const,
      }
    : {
        age: Number(row["sperm_donor_age"]),
        blood_type: row["sperm_donor_blood_type"] as Embryo["sperm_donor"]["blood_type"],
        height: Number(row["sperm_donor_height"]),
        eye_color: row["sperm_donor_eye_color"] as Embryo["sperm_donor"]["eye_color"],
        hair_color: row["sperm_donor_hair_color"] as Embryo["sperm_donor"]["hair_color"],
        ...(row["sperm_donor_education"] != null ? { education: String(row["sperm_donor_education"]) } : {}),
        ...(row["sperm_donor_ethnicity"] != null ? { ethnicity: String(row["sperm_donor_ethnicity"]) } : {}),
      };

  // Zod validates at runtime; cast bridges exactOptionalPropertyTypes gap between Zod inference and hand-written Embryo type
  return EmbryoSchema.parse({
    id: row["id"],
    status: row["status"],
    creation_date: String(row["creation_date"]),
    clinic_id: row["clinic_id"],
    ...(row["sex"] != null ? { sex: row["sex"] } : {}),
    egg_donor,
    sperm_donor,
    phenotype:
      row["phenotype_eye_color"] != null || row["phenotype_hair_color"] != null
        ? {
            eye_color: row["phenotype_eye_color"] ?? null,
            hair_color: row["phenotype_hair_color"] ?? null,
            height_range:
              row["phenotype_height_min"] != null
                ? { min: Number(row["phenotype_height_min"]), max: Number(row["phenotype_height_max"]) }
                : null,
            skin_tone: row["phenotype_skin_tone"] ?? null,
          }
        : undefined,
    genetics: {
      screening_status: row["genetics_screening_status"],
      chromosomal_abnormalities: row["genetics_chromosomal_abnormalities"],
      risk_factors: row["genetics_risk_factors"] ?? undefined,
    },
    medical: {
      quality_grade: row["medical_quality_grade"],
      development_stage: row["medical_development_stage"],
      freeze_date: String(row["medical_freeze_date"]),
    },
    matching:
      row["matching_compatible_blood_types"] != null || row["matching_notes"] != null
        ? {
            compatible_blood_types: row["matching_compatible_blood_types"] ?? undefined,
            notes: row["matching_notes"] ?? undefined,
          }
        : undefined,
    media: {
      embryo_image_url: row["media_embryo_image_url"] ?? undefined,
      donor_photo_available: row["media_donor_photo_available"],
    },
    meta: {
      reservation_expiry: row["meta_reservation_expiry"] ?? undefined,
      priority_score: row["meta_priority_score"] ?? undefined,
      schema_version: String(row["meta_schema_version"]),
      deleted_at: row["meta_deleted_at"] ?? undefined,
    },
  }) as unknown as Embryo;
}

export async function findById(
  sql: Sql,
  id: string,
  opts?: { allowedIds?: string[]; clinicId?: string },
): Promise<Embryo | null> {
  const rows = await sql<EmbryoRow[]>`
    SELECT * FROM embryos
    WHERE id = ${id}
      AND meta_deleted_at IS NULL
      ${opts?.clinicId !== undefined ? sql`AND clinic_id = ${opts.clinicId}` : sql``}
      ${opts?.allowedIds && opts.allowedIds.length > 0
        ? sql`AND id = ANY(${sql.array(opts.allowedIds, 2950)})`
        : sql``}
  `;
  if (rows.length === 0) return null;
  return rowToEmbryo(rows[0]!);
}

export async function findByIdIncludeDeleted(sql: Sql, id: string): Promise<Embryo | null> {
  const rows = await sql<EmbryoRow[]>`SELECT * FROM embryos WHERE id = ${id}`;
  if (rows.length === 0) return null;
  return rowToEmbryo(rows[0]!);
}

export async function findAll(
  sql: Sql,
  filters: { clinic_id?: string; status?: string; include_deleted?: boolean; embryoIds?: string[] } = {},
): Promise<Embryo[]> {
  const rows = await sql<EmbryoRow[]>`
    SELECT * FROM embryos
    WHERE TRUE
      ${filters.clinic_id ? sql`AND clinic_id = ${filters.clinic_id}` : sql``}
      ${filters.status ? sql`AND status = ${filters.status}` : sql``}
      ${!filters.include_deleted ? sql`AND meta_deleted_at IS NULL` : sql``}
      ${filters.embryoIds && filters.embryoIds.length > 0
        ? sql`AND id = ANY(${sql.array(filters.embryoIds, 2950)})`
        : sql``}
    ORDER BY creation_date DESC
  `;
  return rows.map(rowToEmbryo);
}

export async function create(
  sql: Sql,
  input: z.infer<typeof CreateEmbryoSchema>,
  clinicId: string,
): Promise<Embryo> {
  const data = CreateEmbryoSchema.parse(input);
  const rows = await sql<EmbryoRow[]>`
    INSERT INTO embryos (
      clinic_id,
      egg_donor_age, egg_donor_blood_type, egg_donor_height, egg_donor_eye_color, egg_donor_hair_color,
      egg_donor_education, egg_donor_ethnicity,
      sperm_donor_age, sperm_donor_blood_type, sperm_donor_height, sperm_donor_eye_color, sperm_donor_hair_color,
      sperm_donor_education, sperm_donor_ethnicity,
      phenotype_eye_color, phenotype_hair_color, phenotype_height_min, phenotype_height_max, phenotype_skin_tone,
      genetics_screening_status, genetics_chromosomal_abnormalities, genetics_risk_factors,
      medical_quality_grade, medical_development_stage, medical_freeze_date,
      matching_compatible_blood_types, matching_notes,
      media_embryo_image_url, media_donor_photo_available,
      meta_schema_version
    ) VALUES (
      ${clinicId},
      ${data.egg_donor.age}, ${data.egg_donor.blood_type}, ${data.egg_donor.height},
      ${data.egg_donor.eye_color}, ${data.egg_donor.hair_color},
      ${data.egg_donor.education ?? null}, ${data.egg_donor.ethnicity ?? null},
      ${data.sperm_donor.age}, ${data.sperm_donor.blood_type}, ${data.sperm_donor.height},
      ${data.sperm_donor.eye_color}, ${data.sperm_donor.hair_color},
      ${data.sperm_donor.education ?? null}, ${data.sperm_donor.ethnicity ?? null},
      ${data.phenotype?.eye_color ?? null}, ${data.phenotype?.hair_color ?? null},
      ${data.phenotype?.height_range?.min ?? null}, ${data.phenotype?.height_range?.max ?? null},
      ${data.phenotype?.skin_tone ?? null},
      ${data.genetics.screening_status}, ${data.genetics.chromosomal_abnormalities},
      ${data.genetics.risk_factors ? sql.json(data.genetics.risk_factors) : null},
      ${data.medical.quality_grade}, ${data.medical.development_stage}, ${data.medical.freeze_date},
      ${data.matching?.compatible_blood_types ?? null},
      ${data.matching?.notes ?? null},
      ${data.media.embryo_image_url ?? null}, ${data.media.donor_photo_available},
      '1.0.0'
    )
    RETURNING *
  `;
  return rowToEmbryo(rows[0]!);
}

export async function updateStatus(sql: Sql, id: string, newStatus: string): Promise<Embryo | null> {
  const rows = await sql<EmbryoRow[]>`
    UPDATE embryos SET status = ${newStatus}
    WHERE id = ${id} AND meta_deleted_at IS NULL
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return rowToEmbryo(rows[0]!);
}

export async function update(
  sql: Sql,
  id: string,
  patch: Partial<Pick<Embryo, "matching" | "media" | "meta">>,
): Promise<Embryo | null> {
  const existing = await findById(sql, id);
  if (!existing) return null;

  const rows = await sql<EmbryoRow[]>`
    UPDATE embryos SET
      matching_notes = ${patch.matching?.notes ?? existing.matching?.notes ?? null},
      media_embryo_image_url = ${patch.media?.embryo_image_url ?? existing.media.embryo_image_url ?? null},
      media_donor_photo_available = ${patch.media?.donor_photo_available ?? existing.media.donor_photo_available},
      meta_reservation_expiry = ${patch.meta?.reservation_expiry ?? existing.meta.reservation_expiry ?? null},
      meta_priority_score = ${patch.meta?.priority_score ?? existing.meta.priority_score ?? null}
    WHERE id = ${id} AND meta_deleted_at IS NULL
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return rowToEmbryo(rows[0]!);
}

export async function softDeleteById(sql: Sql, id: string): Promise<void> {
  await sql`
    UPDATE embryos SET
      meta_deleted_at = NOW(),
      egg_donor_age = NULL,
      egg_donor_blood_type = NULL,
      egg_donor_height = NULL,
      egg_donor_eye_color = NULL,
      egg_donor_hair_color = NULL,
      egg_donor_education = NULL,
      egg_donor_ethnicity = NULL,
      sperm_donor_age = NULL,
      sperm_donor_blood_type = NULL,
      sperm_donor_height = NULL,
      sperm_donor_eye_color = NULL,
      sperm_donor_hair_color = NULL,
      sperm_donor_education = NULL,
      sperm_donor_ethnicity = NULL,
      phenotype_eye_color = NULL,
      phenotype_hair_color = NULL,
      phenotype_height_min = NULL,
      phenotype_height_max = NULL,
      phenotype_skin_tone = NULL,
      meta_reservation_expiry = NULL
    WHERE id = ${id}
  `;
}
