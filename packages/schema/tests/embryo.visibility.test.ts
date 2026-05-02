import { describe, it, expect } from "vitest";
import { projectEmbryo } from "../src/embryo.visibility.js";
import type { Embryo } from "../src/embryo.types.js";

const fullEmbryo: Embryo = {
  id: "abc-123",
  status: "available",
  creation_date: "2026-01-01T00:00:00Z",
  clinic_id: "clinic-xyz",
  sex: "female",
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
  phenotype: {
    eye_color: "brown",
    hair_color: "dark_brown",
    height_range: { min: 166, max: 176 },
    skin_tone: null,
  },
  genetics: {
    screening_status: "passed",
    chromosomal_abnormalities: false,
    risk_factors: [{ name: "CF carrier", severity: "low" }],
  },
  medical: {
    quality_grade: "A",
    development_stage: "blastocyst",
    freeze_date: "2026-01-15",
  },
  matching: {
    compatible_blood_types: ["A+", "A-", "O+", "O-"],
    notes: "Priority match for recipient cohort 7",
  },
  media: {
    embryo_image_url: null,
    donor_photo_available: false,
  },
  meta: {
    reservation_expiry: null,
    priority_score: 85,
    schema_version: "1.0.0",
    deleted_at: null,
  },
};

describe("projectEmbryo — patient role", () => {
  it("strips id", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result).not.toHaveProperty("id");
  });

  it("strips creation_date", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result).not.toHaveProperty("creation_date");
  });

  it("strips clinic_id", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result).not.toHaveProperty("clinic_id");
  });

  it("strips sex", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result).not.toHaveProperty("sex");
  });

  it("strips genetics.chromosomal_abnormalities", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result.genetics).not.toHaveProperty("chromosomal_abnormalities");
  });

  it("strips genetics.risk_factors", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result.genetics).not.toHaveProperty("risk_factors");
  });

  it("strips matching.notes", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result.matching).not.toHaveProperty("notes");
  });

  it("strips entire meta object", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result).not.toHaveProperty("meta");
  });

  it("retains status", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result.status).toBe("available");
  });

  it("retains egg_donor fields", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result.egg_donor.eye_color).toBe("brown");
  });

  it("retains genetics.screening_status", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result.genetics.screening_status).toBe("passed");
  });

  it("retains medical fields", () => {
    const result = projectEmbryo("patient", fullEmbryo);
    expect(result.medical.quality_grade).toBe("A");
  });
});

describe("projectEmbryo — coordinator role", () => {
  it("includes id", () => {
    const result = projectEmbryo("coordinator", fullEmbryo);
    expect(result.id).toBe("abc-123");
  });

  it("includes sex", () => {
    const result = projectEmbryo("coordinator", fullEmbryo);
    expect(result.sex).toBe("female");
  });

  it("includes genetics.chromosomal_abnormalities", () => {
    const result = projectEmbryo("coordinator", fullEmbryo);
    expect(result.genetics).toHaveProperty("chromosomal_abnormalities");
  });

  it("includes genetics.risk_factors", () => {
    const result = projectEmbryo("coordinator", fullEmbryo);
    expect(result.genetics.risk_factors).toHaveLength(1);
  });

  it("includes meta.schema_version", () => {
    const result = projectEmbryo("coordinator", fullEmbryo);
    expect(result.meta?.schema_version).toBe("1.0.0");
  });

  it("strips meta.deleted_at", () => {
    const result = projectEmbryo("coordinator", fullEmbryo);
    expect(result.meta).not.toHaveProperty("deleted_at");
  });
});

describe("projectEmbryo — admin role", () => {
  it("includes meta.deleted_at", () => {
    const withDeleted: Embryo = {
      ...fullEmbryo,
      meta: { ...fullEmbryo.meta, deleted_at: "2026-03-01T10:00:00Z" },
    };
    const result = projectEmbryo("admin", withDeleted);
    expect(result.meta?.deleted_at).toBe("2026-03-01T10:00:00Z");
  });

  it("includes all coordinator fields plus deleted_at", () => {
    const result = projectEmbryo("admin", fullEmbryo);
    expect(result.id).toBe("abc-123");
    expect(result.sex).toBe("female");
    expect(result.meta).toHaveProperty("deleted_at");
  });
});

describe("projectEmbryo — edge cases", () => {
  it("patient projection handles embryo without phenotype", () => {
    const noPhenotype: Embryo = { ...fullEmbryo };
    delete (noPhenotype as Record<string, unknown>)["phenotype"];
    const result = projectEmbryo("patient", noPhenotype);
    expect(result).not.toHaveProperty("phenotype");
  });

  it("patient projection handles embryo without matching", () => {
    const noMatching: Embryo = { ...fullEmbryo };
    delete (noMatching as Record<string, unknown>)["matching"];
    const result = projectEmbryo("patient", noMatching);
    expect(result).not.toHaveProperty("matching");
  });

  it("patient projection handles matching without compatible_blood_types", () => {
    const matchingNoTypes: Embryo = {
      ...fullEmbryo,
      matching: { notes: "internal note" },
    };
    const result = projectEmbryo("patient", matchingNoTypes);
    if (result.matching) {
      expect(result.matching).not.toHaveProperty("compatible_blood_types");
    }
  });

  it("coordinator projection handles embryo without phenotype", () => {
    const noPhenotype: Embryo = { ...fullEmbryo };
    delete (noPhenotype as Record<string, unknown>)["phenotype"];
    const result = projectEmbryo("coordinator", noPhenotype);
    expect(result).not.toHaveProperty("phenotype");
  });
});
