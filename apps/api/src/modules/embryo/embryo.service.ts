import type postgres from "postgres";
import { CreateEmbryoSchema, CURRENT_SCHEMA_VERSION } from "@embrion/schema";
import type { z } from "zod";
import * as repo from "./embryo.repository.js";
import { projectForCaller } from "./embryo.projection.js";
import type { CallerContext } from "../../middleware/auth-hook.js";

type Sql = postgres.Sql;

export async function getById(
  sql: Sql,
  id: string,
  opts?: { includeDeleted?: boolean; allowedEmbryoIds?: string[]; clinicId?: string },
) {
  if (opts?.includeDeleted) {
    return repo.findByIdIncludeDeleted(sql, id);
  }
  return repo.findById(sql, id, {
    ...(opts?.clinicId !== undefined ? { clinicId: opts.clinicId } : {}),
    ...(opts?.allowedEmbryoIds !== undefined ? { allowedIds: opts.allowedEmbryoIds } : {}),
  });
}

export async function list(
  sql: Sql,
  filters: { clinic_id?: string; status?: string; include_deleted?: boolean },
  opts?: { allowedEmbryoIds?: string[] },
) {
  return repo.findAll(sql, {
    ...filters,
    ...(opts?.allowedEmbryoIds !== undefined ? { embryoIds: opts.allowedEmbryoIds } : {}),
  });
}

export async function createRecord(
  sql: Sql,
  payload: unknown,
  clinicId: string,
  caller: Pick<CallerContext, "role">,
) {
  const parsed = CreateEmbryoSchema.safeParse(payload);
  if (!parsed.success) {
    throw Object.assign(new Error("Validation failed"), {
      statusCode: 400,
      errors: parsed.error.flatten(),
    });
  }

  const embryo = await repo.create(sql, parsed.data as z.infer<typeof CreateEmbryoSchema>, clinicId);
  return projectForCaller(caller.role, embryo);
}

const PERMITTED_TRANSITIONS: Record<string, string[]> = {
  available: ["reserved", "used"],
  reserved: ["available", "used"],
  used: [],
};

export async function changeStatus(
  sql: Sql,
  id: string,
  newStatus: string,
  caller: Pick<CallerContext, "role">,
) {
  const embryo = await repo.findById(sql, id);
  if (!embryo) throw Object.assign(new Error("Not found"), { statusCode: 404 });

  const allowed = PERMITTED_TRANSITIONS[embryo.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw Object.assign(
      new Error(`Transition ${embryo.status} → ${newStatus} is not permitted`),
      { statusCode: 400 },
    );
  }

  const updated = await repo.updateStatus(sql, id, newStatus);
  if (!updated) throw Object.assign(new Error("Not found"), { statusCode: 404 });

  return projectForCaller(caller.role, updated);
}

export async function updateRecord(
  sql: Sql,
  id: string,
  patch: Record<string, unknown>,
  caller: Pick<CallerContext, "role">,
) {
  if ("status" in patch) {
    throw Object.assign(
      new Error("Use PATCH /status to change status"),
      { statusCode: 400 },
    );
  }

  const embryo = await repo.findById(sql, id);
  if (!embryo) throw Object.assign(new Error("Not found"), { statusCode: 404 });

  const updated = await repo.update(sql, id, patch as Parameters<typeof repo.update>[2]);
  if (!updated) throw Object.assign(new Error("Not found"), { statusCode: 404 });

  return projectForCaller(caller.role, updated);
}

export async function softDelete(sql: Sql, id: string) {
  const embryo = await repo.findById(sql, id);
  if (!embryo) throw Object.assign(new Error("Not found"), { statusCode: 404 });

  await repo.softDeleteById(sql, id);
}

// suppress unused import warning
void CURRENT_SCHEMA_VERSION;
