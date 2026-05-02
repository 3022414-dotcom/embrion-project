-- Migration: 001_embryo_schema
-- Description: Create embryos table with all columns from data-model v1.0.0
-- Donor columns are nullable to support soft-delete anonymization (data-model §Soft-Delete Rules)

CREATE TYPE embryo_status AS ENUM ('available', 'reserved', 'used');
CREATE TYPE blood_type AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');
CREATE TYPE eye_color AS ENUM ('blue', 'green', 'brown', 'hazel', 'grey', 'other');
CREATE TYPE hair_color AS ENUM ('black', 'dark_brown', 'brown', 'light_brown', 'blonde', 'red', 'grey', 'other');
CREATE TYPE skin_tone AS ENUM ('very_fair', 'fair', 'medium', 'olive', 'brown', 'dark');
CREATE TYPE screening_status AS ENUM ('passed', 'failed', 'pending', 'not_performed');
CREATE TYPE development_stage AS ENUM ('zygote', 'cleavage', 'morula', 'blastocyst', 'expanded_blastocyst');
CREATE TYPE sex_type AS ENUM ('male', 'female', 'unknown');

CREATE TABLE embryos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status           embryo_status NOT NULL DEFAULT 'available',
  creation_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clinic_id        UUID NOT NULL,
  sex              sex_type,

  -- Egg donor (embedded; nullable to allow soft-delete anonymization)
  egg_donor_age        SMALLINT CHECK (egg_donor_age BETWEEN 18 AND 45),
  egg_donor_blood_type blood_type,
  egg_donor_height     SMALLINT CHECK (egg_donor_height BETWEEN 140 AND 200),
  egg_donor_eye_color  eye_color,
  egg_donor_hair_color hair_color,
  egg_donor_education  TEXT,
  egg_donor_ethnicity  TEXT,

  -- Sperm donor (embedded; nullable to allow soft-delete anonymization)
  sperm_donor_age        SMALLINT CHECK (sperm_donor_age BETWEEN 18 AND 80),
  sperm_donor_blood_type blood_type,
  sperm_donor_height     SMALLINT CHECK (sperm_donor_height BETWEEN 140 AND 210),
  sperm_donor_eye_color  eye_color,
  sperm_donor_hair_color hair_color,
  sperm_donor_education  TEXT,
  sperm_donor_ethnicity  TEXT,

  -- Predicted phenotype (derived; nullable after anonymization)
  phenotype_eye_color    eye_color,
  phenotype_hair_color   hair_color,
  phenotype_height_min   SMALLINT,
  phenotype_height_max   SMALLINT,
  phenotype_skin_tone    skin_tone,

  -- Genetics
  genetics_screening_status           screening_status NOT NULL,
  genetics_chromosomal_abnormalities  BOOLEAN NOT NULL DEFAULT false,
  genetics_risk_factors               JSONB,

  -- Medical
  medical_quality_grade     CHAR(1) NOT NULL CHECK (medical_quality_grade IN ('A', 'B', 'C')),
  medical_development_stage development_stage NOT NULL,
  medical_freeze_date       DATE NOT NULL,

  -- Matching
  matching_compatible_blood_types blood_type[],
  matching_notes                  TEXT,

  -- Media
  media_embryo_image_url     TEXT,
  media_donor_photo_available BOOLEAN NOT NULL DEFAULT false,

  -- Meta
  meta_reservation_expiry TIMESTAMPTZ,
  meta_priority_score     SMALLINT,
  meta_schema_version     TEXT NOT NULL DEFAULT '1.0.0',
  meta_deleted_at         TIMESTAMPTZ
);

CREATE INDEX embryos_clinic_id_idx ON embryos (clinic_id);
CREATE INDEX embryos_status_idx ON embryos (status);
CREATE INDEX embryos_deleted_at_idx ON embryos (meta_deleted_at) WHERE meta_deleted_at IS NOT NULL;
