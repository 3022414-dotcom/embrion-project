import { describe, it, expect } from "vitest";
import { projectForCaller } from "../../src/modules/embryo/embryo.projection.js";
import type { Embryo } from "@embrion/schema";

const fullEmbryo: Embryo = {
  id: "test-id-001",
  status: "available",
  creation_date: "2026-01-01T00:00:00Z",
  clinic_id: "clinic-xyz",
  sex: "male",
  egg_donor: {
    age: 30,
    blood_type: "B+",
    height: 162,
    eye_color: "green",
    hair_color: "blonde",
  },
  sperm_donor: {
    age: 33,
    blood_type: "A+",
    height: 175,
    eye_color: "brown",
    hair_color: "dark_brown",
  },
  phenotype: {
    eye_color: "brown",
    hair_color: "dark_brown",
    height_range: { min: 163, max: 173 },
    skin_tone: null,
  },
  genetics: {
    screening_status: "passed",
    chromosomal_abnormalities: true,
    risk_factors: [{ name: "BRCA2 carrier", severity: "medium" }],
  },
  medical: {
    quality_grade: "A",
    development_stage: "expanded_blastocyst",
    freeze_date: "2026-01-20",
  },
  matching: {
    compatible_blood_types: ["A+", "AB+"],
    notes: "Internal notes for staff only",
  },
  media: {
    embryo_image_url: null,
    donor_photo_available: false,
  },
  meta: {
    reservation_expiry: null,
    priority_score: 90,
    schema_version: "1.0.0",
    deleted_at: null,
  },
};

describe("projectForCaller — coordinator", () => {
  it("includes id, sex, chromosomal_abnormalities", () => {
    const result = projectForCaller("coordinator", fullEmbryo);
    expect(result).toHaveProperty("id", "test-id-001");
    expect(result).toHaveProperty("sex", "male");
    expect((result as { genetics: { chromosomal_abnormalities: boolean } }).genetics.chromosomal_abnormalities).toBe(true);
  });

  it("does NOT include meta.deleted_at", () => {
    const result = projectForCaller("coordinator", fullEmbryo);
    expect((result as { meta?: { deleted_at?: unknown } }).meta).not.toHaveProperty("deleted_at");
  });
});

describe("projectForCaller — admin", () => {
  it("includes meta.deleted_at", () => {
    const withDeleted: Embryo = {
      ...fullEmbryo,
      meta: { ...fullEmbryo.meta, deleted_at: "2026-04-01T08:00:00Z" },
    };
    const result = projectForCaller("admin", withDeleted);
    expect((result as { meta?: { deleted_at?: string } }).meta?.deleted_at).toBe(
      "2026-04-01T08:00:00Z",
    );
  });
});

describe("projectForCaller — patient", () => {
  it("strips id, sex, chromosomal_abnormalities, risk_factors, meta", () => {
    const result = projectForCaller("patient", fullEmbryo);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("sex");
    expect(result).not.toHaveProperty("meta");
    expect((result as { genetics: Record<string, unknown> }).genetics).not.toHaveProperty(
      "chromosomal_abnormalities",
    );
    expect((result as { genetics: Record<string, unknown> }).genetics).not.toHaveProperty(
      "risk_factors",
    );
  });

  it("retains screening_status and medical fields", () => {
    const result = projectForCaller("patient", fullEmbryo);
    expect(
      (result as { genetics: { screening_status: string } }).genetics.screening_status,
    ).toBe("passed");
    expect(
      (result as { medical: { quality_grade: string } }).medical.quality_grade,
    ).toBe("A");
  });
});
