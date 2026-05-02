import { z } from "zod";

export const BloodTypeSchema = z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);
export const EyeColorSchema = z.enum(["blue", "green", "brown", "hazel", "grey", "other"]);
export const HairColorSchema = z.enum([
  "black", "dark_brown", "brown", "light_brown", "blonde", "red", "grey", "other",
]);
export const SkinToneSchema = z.enum([
  "very_fair", "fair", "medium", "olive", "brown", "dark",
]);
export const ScreeningStatusSchema = z.enum([
  "passed", "failed", "pending", "not_performed",
]);
export const DevelopmentStageSchema = z.enum([
  "zygote", "cleavage", "morula", "blastocyst", "expanded_blastocyst",
]);
export const EmbryoStatusSchema = z.enum(["available", "reserved", "used"]);

export const HeightRangeSchema = z.object({
  min: z.number().int(),
  max: z.number().int(),
});

export const RiskFactorSchema = z.object({
  name: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});

export const EggDonorSchema = z.object({
  age: z.number().int().min(18).max(45),
  blood_type: BloodTypeSchema,
  height: z.number().int().min(140).max(200),
  eye_color: EyeColorSchema,
  hair_color: HairColorSchema,
  education: z.string().optional(),
  ethnicity: z.string().optional(),
});

export const SpermDonorSchema = z.object({
  age: z.number().int().min(18).max(80),
  blood_type: BloodTypeSchema,
  height: z.number().int().min(140).max(210),
  eye_color: EyeColorSchema,
  hair_color: HairColorSchema,
  education: z.string().optional(),
  ethnicity: z.string().optional(),
});

export const PhenotypeSchema = z.object({
  eye_color: EyeColorSchema.nullable(),
  hair_color: HairColorSchema.nullable(),
  height_range: HeightRangeSchema.nullable(),
  skin_tone: SkinToneSchema.nullable(),
});

export const GeneticsSchema = z.object({
  screening_status: ScreeningStatusSchema,
  chromosomal_abnormalities: z.boolean(),
  risk_factors: z.array(RiskFactorSchema).optional(),
});

export const MedicalSchema = z.object({
  quality_grade: z.enum(["A", "B", "C"]),
  development_stage: DevelopmentStageSchema,
  freeze_date: z.string(),
});

export const MatchingSchema = z.object({
  compatible_blood_types: z.array(BloodTypeSchema).optional(),
  notes: z.string().nullable().optional(),
});

export const MediaSchema = z.object({
  embryo_image_url: z.string().nullable().optional(),
  donor_photo_available: z.boolean(),
});

export const MetaSchema = z.object({
  reservation_expiry: z.string().nullable().optional(),
  priority_score: z.number().nullable().optional(),
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  deleted_at: z.string().nullable().optional(),
});

const EYE_DOMINANCE: Record<string, number> = {
  brown: 5, hazel: 4, green: 3, blue: 2, grey: 1, other: 0,
};
const HAIR_DOMINANCE: Record<string, number> = {
  black: 7, dark_brown: 6, brown: 5, light_brown: 4, blonde: 3, red: 2, grey: 1, other: 0,
};

function deriveEyeColor(eggEye: string, spermEye: string): string | null {
  /* c8 ignore next */
  return (EYE_DOMINANCE[eggEye] ?? 0) >= (EYE_DOMINANCE[spermEye] ?? 0)
    ? eggEye
    : spermEye;
}

function deriveHairColor(eggHair: string, spermHair: string): string | null {
  /* c8 ignore next */
  return (HAIR_DOMINANCE[eggHair] ?? 0) >= (HAIR_DOMINANCE[spermHair] ?? 0)
    ? eggHair
    : spermHair;
}

function deriveHeightRange(eggH: number, spermH: number) {
  const mid = (eggH + spermH) / 2;
  return { min: Math.floor(mid) - 5, max: Math.ceil(mid) + 5 };
}

export const CreateEmbryoSchema = z
  .object({
    egg_donor: EggDonorSchema,
    sperm_donor: SpermDonorSchema,
    phenotype: PhenotypeSchema.optional(),
    genetics: GeneticsSchema,
    medical: MedicalSchema,
    matching: MatchingSchema.optional(),
    media: MediaSchema,
  })
  .transform((data) => {
    const base = data.phenotype ?? {
      eye_color: null,
      hair_color: null,
      height_range: null,
      skin_tone: null,
    };

    const phenotype = {
      ...base,
      eye_color:
        base.eye_color !== null
          ? base.eye_color
          : (deriveEyeColor(
              data.egg_donor.eye_color,
              data.sperm_donor.eye_color,
            ) as z.infer<typeof EyeColorSchema> | null),
      hair_color:
        base.hair_color !== null
          ? base.hair_color
          : (deriveHairColor(
              data.egg_donor.hair_color,
              data.sperm_donor.hair_color,
            ) as z.infer<typeof HairColorSchema> | null),
      height_range:
        base.height_range !== null
          ? base.height_range
          : deriveHeightRange(data.egg_donor.height, data.sperm_donor.height),
    };

    return { ...data, phenotype };
  });

export const EmbryoSchema = z.object({
  id: z.string(),
  status: EmbryoStatusSchema,
  creation_date: z.string(),
  clinic_id: z.string(),
  sex: z.enum(["male", "female", "unknown"]).optional(),
  egg_donor: EggDonorSchema,
  sperm_donor: SpermDonorSchema,
  phenotype: PhenotypeSchema.optional(),
  genetics: GeneticsSchema,
  medical: MedicalSchema,
  matching: MatchingSchema.optional(),
  media: MediaSchema,
  meta: MetaSchema,
});
