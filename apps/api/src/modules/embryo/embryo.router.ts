import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { SCHEMA_MANIFEST } from "@embrion/schema";
import { requireRole } from "../../middleware/require-role.js";
import * as service from "./embryo.service.js";
import { projectForCaller } from "./embryo.projection.js";
import * as selectionRepo from "../auth/selection.repository.js";

export async function embryoRouter(
  app: FastifyInstance,
  opts: { sql: postgres.Sql },
) {
  const { sql } = opts;

  app.get("/api/v1/schema/manifest", async (_req, reply) => {
    return reply.send(SCHEMA_MANIFEST);
  });

  app.get("/api/v1/embryos", async (request, reply) => {
    const caller = request.caller!;
    const query = request.query as { status?: string };
    const allowedEmbryoIds = caller.role === "patient" ? caller.embryo_ids : undefined;
    const clinicId = caller.role !== "admin" ? caller.clinic_id : undefined;

    const embryos = await service.list(
      sql,
      {
        ...query,
        ...(clinicId !== undefined ? { clinic_id: clinicId } : {}),
        include_deleted: caller.role === "admin",
      },
      allowedEmbryoIds !== undefined ? { allowedEmbryoIds } : undefined,
    );

    if (caller.role === "patient" && caller.selection_id) {
      await selectionRepo.setOpenedAt(sql, caller.selection_id);
    }

    return reply.send(embryos.map((e) => projectForCaller(caller.role, e)));
  });

  app.get<{ Params: { id: string } }>("/api/v1/embryos/:id", async (request, reply) => {
    const caller = request.caller!;
    const allowedEmbryoIds = caller.role === "patient" ? caller.embryo_ids : undefined;
    const clinicId = caller.role === "coordinator" ? caller.clinic_id : undefined;

    const embryo = await service.getById(sql, request.params.id, {
      includeDeleted: caller.role === "admin",
      ...(clinicId !== undefined ? { clinicId } : {}),
      ...(allowedEmbryoIds !== undefined ? { allowedEmbryoIds } : {}),
    });
    if (!embryo) return reply.status(404).send({ error: "Not found" });
    return reply.send(projectForCaller(caller.role, embryo));
  });

  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    "/api/v1/embryos/:id/status",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      try {
        const result = await service.changeStatus(sql, request.params.id, request.body.status, caller);
        return reply.send(result);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/embryos/:id/delete",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      try {
        await service.softDelete(sql, request.params.id);
        return reply.status(204).send();
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/embryos",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      try {
        const clinicId =
          caller.role === "coordinator"
            ? caller.clinic_id
            : (request.body["clinic_id"] as string | undefined) ?? "default-clinic";
        const result = await service.createRecord(sql, request.body, clinicId, caller);
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string; errors?: unknown };
        return reply
          .status(e.statusCode ?? 400)
          .send({ error: e.message, details: (e as { errors?: unknown }).errors });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/embryos/:id",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      try {
        const result = await service.updateRecord(sql, request.params.id, request.body, caller);
        return reply.send(result);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );
}
