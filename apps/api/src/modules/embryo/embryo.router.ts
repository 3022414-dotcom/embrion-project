import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { SCHEMA_MANIFEST } from "@embrion/schema";
import type { Role } from "@embrion/schema";
import * as service from "./embryo.service.js";

declare module "fastify" {
  interface FastifyRequest {
    jwtPayload?: { role: Role; sub: string };
  }
}

export async function embryoRouter(
  app: FastifyInstance,
  opts: { sql: postgres.Sql },
) {
  const { sql } = opts;

  app.addHook("onRequest", async (request, reply) => {
    try {
      await request.jwtVerify();
      request.jwtPayload = request.user as { role: Role; sub: string };
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/schema/manifest", async (_req, reply) => {
    return reply.send(SCHEMA_MANIFEST);
  });

  app.get("/api/v1/embryos", async (request, reply) => {
    const role = request.jwtPayload!.role;
    const query = request.query as { clinic_id?: string; status?: string };
    const results = await service.list(sql, query, role);
    return reply.send(results);
  });

  app.get<{ Params: { id: string } }>("/api/v1/embryos/:id", async (request, reply) => {
    const role = request.jwtPayload!.role;
    const record = await service.getById(sql, request.params.id, role);
    if (!record) return reply.status(404).send({ error: "Not found" });
    return reply.send(record);
  });

  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    "/api/v1/embryos/:id/status",
    async (request, reply) => {
      const role = request.jwtPayload!.role;
      try {
        const result = await service.changeStatus(sql, request.params.id, request.body.status, role);
        return reply.send(result);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/embryos/:id/delete",
    async (request, reply) => {
      const role = request.jwtPayload!.role;
      try {
        await service.softDelete(sql, request.params.id, role);
        return reply.status(204).send();
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/embryos",
    async (request, reply) => {
      const role = request.jwtPayload!.role;
      try {
        const clinicId = (request.jwtPayload as { clinic_id?: string }).clinic_id ?? "default-clinic";
        const result = await service.createRecord(sql, request.body as Parameters<typeof service.createRecord>[1], clinicId, role);
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string; errors?: unknown };
        return reply.status(e.statusCode ?? 400).send({ error: e.message, details: (e as { errors?: unknown }).errors });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/embryos/:id",
    async (request, reply) => {
      const role = request.jwtPayload!.role;
      try {
        const result = await service.updateRecord(sql, request.params.id, request.body, role);
        return reply.send(result);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );
}
