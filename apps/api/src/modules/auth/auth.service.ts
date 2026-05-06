import { randomBytes } from "crypto";
import type postgres from "postgres";
import type { CallerContext } from "../../middleware/auth-hook.js";
import * as selectionRepo from "./selection.repository.js";
import * as tokenRepo from "./token.repository.js";
import * as auditRepo from "./audit.repository.js";

type Sql = postgres.Sql;

export type TokenValidationResult =
  | { status: "valid"; caller: CallerContext }
  | { status: "expired" }
  | { status: "invalid" };

export async function issueToken(
  sql: Sql,
  input: { patientId: string; issuedBy: string; ttlDays: number; clinicId: string },
): Promise<{ tokenValue: string; expiresAt: Date }> {
  const selection = await selectionRepo.findByPatientId(sql, input.patientId);
  if (!selection) {
    throw Object.assign(new Error("No selection exists for this patient"), { statusCode: 400 });
  }

  await tokenRepo.revokeByPatientId(sql, input.patientId, input.issuedBy);

  const tokenValue = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);

  const token = await tokenRepo.create(sql, {
    tokenValue,
    patientId: input.patientId,
    selectionId: selection.id,
    clinicId: input.clinicId,
    expiresAt,
    issuedBy: input.issuedBy,
  });

  await auditRepo.logEvent(sql, {
    tokenId: token.id,
    event: "issued",
    actorId: input.issuedBy,
    actorRole: "coordinator",
  });

  return { tokenValue, expiresAt };
}

export async function validatePatientToken(
  sql: Sql,
  tokenValue: string,
  ipAddress?: string,
): Promise<TokenValidationResult> {
  const active = await tokenRepo.findActive(sql, tokenValue);
  if (active) {
    await auditRepo.logEvent(sql, {
      tokenId: active.token.id,
      event: "used",
      actorId: active.token.patient_id,
      actorRole: "patient",
      ...(ipAddress !== undefined ? { ipAddress } : {}),
    });
    const caller: CallerContext = {
      role: "patient",
      sub: active.token.patient_id,
      clinic_id: active.token.clinic_id,
      selection_id: active.token.selection_id,
      embryo_ids: active.embryoIds,
    };
    return { status: "valid", caller };
  }

  const existing = await tokenRepo.findByTokenValue(sql, tokenValue);
  if (existing) {
    await auditRepo.logEvent(sql, {
      tokenId: existing.id,
      event: "expired_attempt",
      ...(ipAddress !== undefined ? { ipAddress } : {}),
    });
    return { status: "expired" };
  }

  await auditRepo.logEvent(sql, {
    event: "unauthorized_attempt",
    ...(ipAddress !== undefined ? { ipAddress } : {}),
  });
  return { status: "invalid" };
}

export async function revokeToken(
  sql: Sql,
  patientId: string,
  revokedBy: string,
): Promise<void> {
  await tokenRepo.revokeByPatientId(sql, patientId, revokedBy);
  await auditRepo.logEvent(sql, {
    event: "revoked",
    actorId: revokedBy,
  });
}
