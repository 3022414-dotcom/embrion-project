import { describe, it, expect } from "vitest";
import { EmbryoSchema, CreateEmbryoSchema } from "../src/embryo.schema.js";
import { CURRENT_SCHEMA_VERSION, SCHEMA_MANIFEST } from "../src/embryo.manifest.js";

const validBase = {
  egg_donor: {
    age: 28,
    blood_type: "A+",
    height: 165,
    eye_color: "brown",
    hair_color: "dark_brown",
  },
  sperm_donor: {
    age: 32,
    blood_type: "O+",
    height: 178,
    eye_color: "blue",
    hair_color: "brown",
  },
  genetics: {
    screening_status: "passed",
    chromosomal_abnormalities: false,
  },
  medical: {
    quality_grade: "A",
    development_stage: "blastocyst",
    freeze_date: "2026-01-15",
  },
  media: {
    donor_photo_available: false,
  },
};

describe("EmbryoSchema — required fields", () => {
  it("accepts a valid minimal record", () => {
    const result = CreateEmbryoSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects missing medical.quality_grade", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["medical"] as Record<string, unknown>)["quality_grade"] = undefined;
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("medical.quality_grade");
    }
  });

  it("rejects missing egg_donor.height", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    delete (bad["egg_donor"] as Record<string, unknown>)["height"];
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects missing genetics sub-record", () => {
    const bad = { ...validBase, genetics: undefined };
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("EmbryoSchema — enum constraints", () => {
  it("rejects invalid status", () => {
    const result = EmbryoSchema.safeParse({
      ...validBase,
      id: "uuid",
      status: "pending",
      creation_date: new Date().toISOString(),
      clinic_id: "clinic-uuid",
      meta: { schema_version: "1.0.0" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid quality_grade", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["medical"] as Record<string, unknown>)["quality_grade"] = "D";
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects invalid blood_type", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["egg_donor"] as Record<string, unknown>)["blood_type"] = "X+";
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects invalid development_stage", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["medical"] as Record<string, unknown>)["development_stage"] = "embryo";
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("EmbryoSchema — range constraints", () => {
  it("rejects egg_donor.age below 18", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["egg_donor"] as Record<string, unknown>)["age"] = 17;
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects egg_donor.age above 45", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["egg_donor"] as Record<string, unknown>)["age"] = 46;
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects egg_donor.height below 140", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["egg_donor"] as Record<string, unknown>)["height"] = 139;
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects egg_donor.height above 200", () => {
    const bad = structuredClone(validBase) as Record<string, unknown>;
    (bad["egg_donor"] as Record<string, unknown>)["height"] = 201;
    const result = CreateEmbryoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("EmbryoSchema — schema_version format", () => {
  it("rejects invalid semver in schema_version", () => {
    const result = EmbryoSchema.safeParse({
      ...validBase,
      id: "uuid",
      status: "available",
      creation_date: new Date().toISOString(),
      clinic_id: "clinic-uuid",
      meta: { schema_version: "v1" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid semver in schema_version", () => {
    const result = EmbryoSchema.safeParse({
      ...validBase,
      id: "uuid",
      status: "available",
      creation_date: new Date().toISOString(),
      clinic_id: "clinic-uuid",
      meta: { schema_version: "1.0.0" },
    });
    expect(result.success).toBe(true);
  });
});

describe("EmbryoSchema — phenotype inheritance", () => {
  it("derives phenotype from donor data when absent", () => {
    const result = CreateEmbryoSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phenotype).toBeDefined();
      expect(result.data.phenotype?.eye_color).toBeDefined();
    }
  });

  it("does not override explicitly provided phenotype fields", () => {
    const withPhenotype = {
      ...validBase,
      phenotype: {
        eye_color: "blue" as const,
        hair_color: "blonde" as const,
        height_range: { min: 160, max: 170 },
        skin_tone: null,
      },
    };
    const result = CreateEmbryoSchema.safeParse(withPhenotype);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phenotype.eye_color).toBe("blue");
      expect(result.data.phenotype.hair_color).toBe("blonde");
      expect(result.data.phenotype.height_range?.min).toBe(160);
    }
  });

  it("derives darker hair color when donors have different colors", () => {
    const base = {
      ...validBase,
      egg_donor: { ...validBase.egg_donor, hair_color: "blonde" as const },
      sperm_donor: { ...validBase.sperm_donor, hair_color: "black" as const },
    };
    const result = CreateEmbryoSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phenotype.hair_color).toBe("black");
    }
  });

  it("sperm donor eye color wins when more dominant", () => {
    const base = {
      ...validBase,
      egg_donor: { ...validBase.egg_donor, eye_color: "blue" as const },
      sperm_donor: { ...validBase.sperm_donor, eye_color: "brown" as const },
    };
    const result = CreateEmbryoSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phenotype.eye_color).toBe("brown");
    }
  });
});

describe("EmbryoSchema — manifest", () => {
  it("CURRENT_SCHEMA_VERSION is valid semver", () => {
    expect(CURRENT_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("SCHEMA_MANIFEST contains current version in changelog", () => {
    expect(SCHEMA_MANIFEST.current_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(SCHEMA_MANIFEST.changelog.length).toBeGreaterThan(0);
    const entry = SCHEMA_MANIFEST.changelog[0];
    expect(entry?.version).toBe("1.0.0");
  });
});
