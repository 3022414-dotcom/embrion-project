# Data Model: F-01 — Embryo Data Model

**Version**: 1.0.0
**Date**: 2026-05-01
**Source**: `packages/schema/src/embryo.types.ts` (canonical TypeScript types)

---

## Embryo Record — Full Field Catalogue

### Basic Info

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` (UUID) | Yes | System-generated; internal identifier |
| `status` | `"available" \| "reserved" \| "used"` | Yes | See State Machine section |
| `creation_date` | `string` (ISO 8601) | Yes | Set at record creation; immutable |
| `clinic_id` | `string` (UUID) | Yes | Owning clinic identifier |
| `sex` | `"male" \| "female" \| "unknown"` | No | Coordinator + Admin only |

### Egg Donor (embedded)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `egg_donor.age` | `number` (integer, 18–45) | Yes | Age at donation |
| `egg_donor.blood_type` | `BloodType` | Yes | See enum below |
| `egg_donor.education` | `string` | No | Free text |
| `egg_donor.ethnicity` | `string` | No | Free text |
| `egg_donor.height` | `number` (integer, cm) | Yes | 140–200 |
| `egg_donor.eye_color` | `EyeColor` | Yes | See enum below |
| `egg_donor.hair_color` | `HairColor` | Yes | See enum below |

### Sperm Donor (embedded, same structure as Egg Donor)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sperm_donor.age` | `number` | Yes | |
| `sperm_donor.blood_type` | `BloodType` | Yes | |
| `sperm_donor.education` | `string` | No | |
| `sperm_donor.ethnicity` | `string` | No | |
| `sperm_donor.height` | `number` | Yes | |
| `sperm_donor.eye_color` | `EyeColor` | Yes | |
| `sperm_donor.hair_color` | `HairColor` | Yes | |

### Predicted Phenotype (derived — see Inheritance Rules)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `phenotype.eye_color` | `EyeColor \| null` | No | Derived from donor eye colors if absent |
| `phenotype.hair_color` | `HairColor \| null` | No | Derived from donor hair colors if absent |
| `phenotype.height_range` | `HeightRange \| null` | No | Derived from donor heights if absent |
| `phenotype.skin_tone` | `SkinTone \| null` | No | Derived if absent |

### Genetics

| Field | Type | Required | Role Visibility |
|-------|------|----------|-----------------|
| `genetics.screening_status` | `ScreeningStatus` | Yes | All roles |
| `genetics.chromosomal_abnormalities` | `boolean` | Yes | Coordinator + Admin |
| `genetics.risk_factors` | `RiskFactor[]` | No | Coordinator + Admin |

`RiskFactor`: `{ name: string; severity: "low" | "medium" | "high" }`

### Medical

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `medical.quality_grade` | `"A" \| "B" \| "C"` | Yes | |
| `medical.development_stage` | `DevelopmentStage` | Yes | See enum below |
| `medical.freeze_date` | `string` (ISO 8601 date) | Yes | |

### Matching

| Field | Type | Required | Role Visibility |
|-------|------|----------|-----------------|
| `matching.compatible_blood_types` | `BloodType[]` | No | All roles |
| `matching.notes` | `string \| null` | No | Coordinator + Admin |

### Media

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `media.embryo_image_url` | `string \| null` | No | URL to image asset |
| `media.donor_photo_available` | `boolean` | Yes | Flag only; no URL for patients |

### Meta

| Field | Type | Required | Role Visibility |
|-------|------|----------|-----------------|
| `meta.reservation_expiry` | `string \| null` (ISO 8601) | No | Coordinator + Admin |
| `meta.priority_score` | `number \| null` | No | Coordinator + Admin |
| `meta.schema_version` | `string` (semver) | Yes | Coordinator + Admin |
| `meta.deleted_at` | `string \| null` (ISO 8601) | No | Admin only |

---

## Enumerations

```typescript
type BloodType = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";

type EyeColor = "blue" | "green" | "brown" | "hazel" | "grey" | "other";

type HairColor = "black" | "dark_brown" | "brown" | "light_brown" |
                 "blonde" | "red" | "grey" | "other";

type SkinTone = "very_fair" | "fair" | "medium" | "olive" | "brown" | "dark";

type ScreeningStatus = "passed" | "failed" | "pending" | "not_performed";

type DevelopmentStage = "zygote" | "cleavage" | "morula" |
                        "blastocyst" | "expanded_blastocyst";

type HeightRange = { min: number; max: number }; // cm, integers
```

---

## Role Visibility Matrix

`✓` = visible | `✗` = stripped from response

| Field Group | Field | Patient | Coordinator | Admin |
|-------------|-------|---------|-------------|-------|
| Basic | `id` | ✗ | ✓ | ✓ |
| Basic | `status` | ✓ | ✓ | ✓ |
| Basic | `creation_date` | ✗ | ✓ | ✓ |
| Basic | `clinic_id` | ✗ | ✓ | ✓ |
| Basic | `sex` | ✗ | ✓ | ✓ |
| Egg Donor | all fields | ✓ | ✓ | ✓ |
| Sperm Donor | all fields | ✓ | ✓ | ✓ |
| Phenotype | all fields | ✓ | ✓ | ✓ |
| Genetics | `screening_status` | ✓ | ✓ | ✓ |
| Genetics | `chromosomal_abnormalities` | ✗ | ✓ | ✓ |
| Genetics | `risk_factors` | ✗ | ✓ | ✓ |
| Medical | all fields | ✓ | ✓ | ✓ |
| Matching | `compatible_blood_types` | ✓ | ✓ | ✓ |
| Matching | `notes` | ✗ | ✓ | ✓ |
| Media | `embryo_image_url` | ✓ | ✓ | ✓ |
| Media | `donor_photo_available` | ✓ | ✓ | ✓ |
| Meta | `reservation_expiry` | ✗ | ✓ | ✓ |
| Meta | `priority_score` | ✗ | ✓ | ✓ |
| Meta | `schema_version` | ✗ | ✓ | ✓ |
| Meta | `deleted_at` | ✗ | ✗ | ✓ |

---

## Status State Machine

```
              ┌──────────────────────────────────────────┐
              │                                          │
         ┌────▼─────┐   reserve    ┌────────────┐       │
         │ available │─────────────▶│  reserved  │       │ release
         └────┬─────┘              └─────┬──────┘       │
              │                          │               │
              │ use (direct)             │ use           └───────────────┐
              │                          │                               │
              └──────────┬───────────────┘          ┌──────────┐        │
                         │                           │ reserved │◀───────┘
                         ▼                           └──────────┘
                    ┌─────────┐
                    │  used   │  ← TERMINAL (no transitions out)
                    └─────────┘
```

**Permitted transitions** (coordinator + admin only):

| From | To | Notes |
|------|----|-------|
| `available` | `reserved` | Normal reservation flow |
| `reserved` | `available` | Release — clears `reservation_expiry` |
| `available` | `used` | Direct use (skipping reservation) — logged as non-standard |
| `reserved` | `used` | Standard completion |

**Forbidden transitions**: Any transition out of `used`; any status not in the table above.

---

## Donor Field Inheritance Rules (Predicted Phenotype)

Inheritance runs at record write time. A phenotype field is derived **only if absent**
in the submitted record. Explicitly provided values are never overwritten.

| Phenotype field | Inheritance logic |
|-----------------|-------------------|
| `phenotype.eye_color` | Dominant eye color wins (brown > hazel > green > blue/grey); if both donors have same color, use it; if unknown, leave null |
| `phenotype.hair_color` | Darker color is dominant (black > dark_brown > brown > light_brown > blonde > red); if unknown, leave null |
| `phenotype.height_range` | `{ min: floor((egg_height + sperm_height) / 2) - 5, max: ceil((egg_height + sperm_height) / 2) + 5 }` cm |
| `phenotype.skin_tone` | Darker of the two donor skin tones; if not inferrable (one or both unknown), leave null |

If the donor field required for inheritance is absent, the derived field is set to null
and a warning is logged (record creation is not blocked).

---

## Soft-Delete Rules

When an admin triggers soft-delete on an embryo:

1. `meta.deleted_at` is set to the current UTC timestamp.
2. The following donor personal fields are set to `null`:
   - All `egg_donor.*` fields
   - All `sperm_donor.*` fields
   - `phenotype.*` (derived from donor data — also nulled)
3. Medical fields (`medical.*`, `genetics.*`, `matching.*`, `media.*`) are retained.
4. `meta.schema_version` and `meta.priority_score` are retained.
5. If the record was in `reserved` status, the reservation is implicitly cancelled
   (`meta.reservation_expiry` is set to null, status transitions to `available` before
   deletion is applied to enable audit trail clarity).
6. Soft-deleted records are excluded from all non-admin queries automatically.

---

## Validation Rules Summary

| Rule | Zod constraint |
|------|---------------|
| `status` value | `z.enum(["available", "reserved", "used"])` |
| `egg_donor.age` | `z.number().int().min(18).max(45)` |
| `egg_donor.height` | `z.number().int().min(140).max(200)` |
| `sperm_donor.age` | `z.number().int().min(18).max(80)` |
| `sperm_donor.height` | `z.number().int().min(140).max(210)` |
| `medical.quality_grade` | `z.enum(["A", "B", "C"])` |
| `meta.schema_version` | `z.string().regex(/^\d+\.\d+\.\d+$/)` |
| `genetics.risk_factors[].severity` | `z.enum(["low", "medium", "high"])` |
| `meta.deleted_at` → status transition | Enforced in service layer, not Zod |
