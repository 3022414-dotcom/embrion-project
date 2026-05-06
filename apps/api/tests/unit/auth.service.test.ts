import { describe, it, expect, vi, beforeEach } from "vitest";
import * as authService from "../../src/modules/auth/auth.service.js";
import * as tokenRepo from "../../src/modules/auth/token.repository.js";
import * as auditRepo from "../../src/modules/auth/audit.repository.js";
import * as selectionRepo from "../../src/modules/auth/selection.repository.js";

const mockSql = {} as Parameters<typeof authService.issueToken>[0];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("auth.service — issueToken", () => {
  it("returns a 64-char hex token value", async () => {
    vi.spyOn(selectionRepo, "findByPatientId").mockResolvedValue({
      id: "sel-1",
      patient_id: "pat-1",
      clinic_id: "clinic-a",
      embryo_ids: [],
      created_by: "coord-1",
      created_at: new Date(),
      updated_at: new Date(),
    });
    vi.spyOn(tokenRepo, "revokeByPatientId").mockResolvedValue(undefined);
    vi.spyOn(tokenRepo, "create").mockImplementation(async (_sql, input) => ({
      id: "tok-1",
      token_value: input.tokenValue,
      patient_id: input.patientId,
      selection_id: input.selectionId,
      clinic_id: input.clinicId,
      expires_at: input.expiresAt,
      issued_by: input.issuedBy,
      issued_at: new Date(),
      revoked_at: null,
      revoked_by: null,
    }));
    vi.spyOn(auditRepo, "logEvent").mockResolvedValue(undefined);

    const result = await authService.issueToken(mockSql, {
      patientId: "pat-1",
      issuedBy: "coord-1",
      ttlDays: 30,
      clinicId: "clinic-a",
    });

    expect(result.tokenValue).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("revokes existing token before issuing a new one", async () => {
    vi.spyOn(selectionRepo, "findByPatientId").mockResolvedValue({
      id: "sel-1",
      patient_id: "pat-1",
      clinic_id: "clinic-a",
      embryo_ids: [],
      created_by: "coord-1",
      created_at: new Date(),
      updated_at: new Date(),
    });
    const revokeSpy = vi.spyOn(tokenRepo, "revokeByPatientId").mockResolvedValue(undefined);
    vi.spyOn(tokenRepo, "create").mockImplementation(async (_sql, input) => ({
      id: "tok-2",
      token_value: input.tokenValue,
      patient_id: input.patientId,
      selection_id: input.selectionId,
      clinic_id: input.clinicId,
      expires_at: input.expiresAt,
      issued_by: input.issuedBy,
      issued_at: new Date(),
      revoked_at: null,
      revoked_by: null,
    }));
    vi.spyOn(auditRepo, "logEvent").mockResolvedValue(undefined);

    await authService.issueToken(mockSql, {
      patientId: "pat-1",
      issuedBy: "coord-1",
      ttlDays: 30,
      clinicId: "clinic-a",
    });

    expect(revokeSpy).toHaveBeenCalledWith(mockSql, "pat-1", "coord-1");
  });

  it("throws 400 if no selection exists for patient", async () => {
    vi.spyOn(selectionRepo, "findByPatientId").mockResolvedValue(null);

    await expect(
      authService.issueToken(mockSql, {
        patientId: "pat-no-selection",
        issuedBy: "coord-1",
        ttlDays: 30,
        clinicId: "clinic-a",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("auth.service — validatePatientToken", () => {
  it("returns status=valid with CallerContext for an active token", async () => {
    vi.spyOn(tokenRepo, "findActive").mockResolvedValue({
      token: {
        id: "tok-1",
        token_value: "a".repeat(64),
        patient_id: "pat-1",
        selection_id: "sel-1",
        clinic_id: "clinic-a",
        expires_at: new Date(Date.now() + 86400_000),
        issued_by: "coord-1",
        issued_at: new Date(),
        revoked_at: null,
        revoked_by: null,
      },
      embryoIds: ["emb-1", "emb-2"],
    });
    vi.spyOn(auditRepo, "logEvent").mockResolvedValue(undefined);

    const result = await authService.validatePatientToken(mockSql, "a".repeat(64));

    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.caller.role).toBe("patient");
      expect(result.caller.clinic_id).toBe("clinic-a");
      expect(result.caller.embryo_ids).toEqual(["emb-1", "emb-2"]);
    }
  });

  it("returns status=expired and logs expired_attempt for an expired/revoked token", async () => {
    vi.spyOn(tokenRepo, "findActive").mockResolvedValue(null);
    vi.spyOn(tokenRepo, "findByTokenValue").mockResolvedValue({
      id: "tok-1",
      token_value: "b".repeat(64),
      patient_id: "pat-1",
      selection_id: "sel-1",
      clinic_id: "clinic-a",
      expires_at: new Date(Date.now() - 1000),
      issued_by: "coord-1",
      issued_at: new Date(),
      revoked_at: null,
      revoked_by: null,
    });
    const logSpy = vi.spyOn(auditRepo, "logEvent").mockResolvedValue(undefined);

    const result = await authService.validatePatientToken(mockSql, "b".repeat(64));

    expect(result.status).toBe("expired");
    expect(logSpy).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({ event: "expired_attempt" }),
    );
  });

  it("returns status=invalid and logs unauthorized_attempt for an unknown token", async () => {
    vi.spyOn(tokenRepo, "findActive").mockResolvedValue(null);
    vi.spyOn(tokenRepo, "findByTokenValue").mockResolvedValue(null);
    const logSpy = vi.spyOn(auditRepo, "logEvent").mockResolvedValue(undefined);

    const result = await authService.validatePatientToken(mockSql, "c".repeat(64));

    expect(result.status).toBe("invalid");
    expect(logSpy).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({ event: "unauthorized_attempt" }),
    );
  });
});

describe("auth.service — revokeToken", () => {
  it("calls revokeByPatientId and logs revoked event", async () => {
    const revokeSpy = vi.spyOn(tokenRepo, "revokeByPatientId").mockResolvedValue(undefined);
    const logSpy = vi.spyOn(auditRepo, "logEvent").mockResolvedValue(undefined);

    await authService.revokeToken(mockSql, "pat-1", "coord-1");

    expect(revokeSpy).toHaveBeenCalledWith(mockSql, "pat-1", "coord-1");
    expect(logSpy).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({ event: "revoked" }),
    );
  });
});
