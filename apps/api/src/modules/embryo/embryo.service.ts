import type postgres from "postgres";
import type { Role } from "@embrion/schema";
import { CreateEmbryoSchema, CURRENT_SCHEMA_VERSION } from "@embrion/schema";
import type { z } from "zod";
import * as repo from "./embryo.repository.js";
import { projectForCaller } from "./embryo.projection.js";

type Sql = postgres.Sql;

export async function getById(sql: Sql, id: string, role: Role) {
  const embryo = role === "admin"
    ? await repo.findByIdIncludeDeleted(sql, id)
    : await repo.findById(sql, id);
  if (!embryo) return null;
  return projectForCaller(role, embryo);
}

export async function list(
  sql: Sql,
  filters: { clinic_id?: string; status?: string },
  role: Role,
) {
  const embryos = await repo.findAll(sql, {
    ...filters,
    include_deleted: role === "admin",
  });
  return embryos.map((e) => projectForCaller(role, e));
}

export async function createRecord(
  sql: Sql,
  payload: unknown,
  clinicId: string,
  role: Role,
) {
  if (role === "patient") throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const parsed = CreateEmbryoSchema.safeParse(payload);
  if (!parsed.success) {
    throw Object.assign(new Error("Validation failed"), {
      statusCode: 400,
      errors: parsed.error.flatten(),
    });
  }

  const embryo = await repo.create(sql, parsed.data as z.infer<typeof CreateEmbryoSchema>, clinicId);
  return projectForCaller(role, embryo);
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
  role: Role,
) {
  if (role === "patient") throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

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

  return projectForCaller(role, updated);
}

export async function updateRecord(
  sql: Sql,
  id: string,
  patch: Record<string, unknown>,
  role: Role,
) {
  if (role === "patient") throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
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

  return projectForCaller(role, updated);
}

export async function softDelete(sql: Sql, id: string, role: Role) {
  if (role !== "admin") throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const embryo = await repo.findById(sql, id);
  if (!embryo) throw Object.assign(new Error("Not found"), { statusCode: 404 });

  await repo.softDeleteById(sql, id);
}

// suppress unused import warning
void CURRENT_SCHEMA_VERSION;
