export type BloodType = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";

export type EyeColor = "blue" | "green" | "brown" | "hazel" | "grey" | "other";

export type HairColor =
  | "black"
  | "dark_brown"
  | "brown"
  | "light_brown"
  | "blonde"
  | "red"
  | "grey"
  | "other";

export type SkinTone =
  | "very_fair"
  | "fair"
  | "medium"
  | "olive"
  | "brown"
  | "dark";

export type ScreeningStatus = "passed" | "failed" | "pending" | "not_performed";

export type DevelopmentStage =
  | "zygote"
  | "cleavage"
  | "morula"
  | "blastocyst"
  | "expanded_blastocyst";

export type EmbryoStatus = "available" | "reserved" | "used";

export type Sex = "male" | "female" | "unknown";

export type HeightRange = { min: number; max: number };

export type RiskFactor = {
  name: string;
  severity: "low" | "medium" | "high";
};

export type EggDonor = {
  age: number;
  blood_type: BloodType;
  height: number;
  eye_color: EyeColor;
  hair_color: HairColor;
  education?: string;
  ethnicity?: string;
};

export type SpermDonor = {
  age: number;
  blood_type: BloodType;
  height: number;
  eye_color: EyeColor;
  hair_color: HairColor;
  education?: string;
  ethnicity?: string;
};

export type Phenotype = {
  eye_color: EyeColor | null;
  hair_color: HairColor | null;
  height_range: HeightRange | null;
  skin_tone: SkinTone | null;
};

export type Genetics = {
  screening_status: ScreeningStatus;
  chromosomal_abnormalities: boolean;
  risk_factors?: RiskFactor[];
};

export type Medical = {
  quality_grade: "A" | "B" | "C";
  development_stage: DevelopmentStage;
  freeze_date: string;
};

export type Matching = {
  compatible_blood_types?: BloodType[];
  notes?: string | null;
};

export type Media = {
  embryo_image_url?: string | null;
  donor_photo_available: boolean;
};

export type Meta = {
  reservation_expiry?: string | null;
  priority_score?: number | null;
  schema_version: string;
  deleted_at?: string | null;
};

export type Embryo = {
  id: string;
  status: EmbryoStatus;
  creation_date: string;
  clinic_id: string;
  sex?: Sex;
  egg_donor: EggDonor;
  sperm_donor: SpermDonor;
  phenotype?: Phenotype;
  genetics: Genetics;
  medical: Medical;
  matching?: Matching;
  media: Media;
  meta: Meta;
};

export type Role = "patient" | "coordinator" | "admin";

export type EmbryoForPatient = {
  status: EmbryoStatus;
  egg_donor: EggDonor;
  sperm_donor: SpermDonor;
  phenotype?: Phenotype;
  genetics: {
    screening_status: ScreeningStatus;
  };
  medical: Medical;
  matching?: {
    compatible_blood_types?: BloodType[];
  };
  media: Media;
};

export type EmbryoForCoordinator = Omit<Embryo, "meta"> & {
  meta: Omit<Meta, "deleted_at">;
};

export type EmbryoForAdmin = Embryo;
