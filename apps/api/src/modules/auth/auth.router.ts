import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { requireRole } from "../../middleware/require-role.js";
import * as patientRepo from "./patient.repository.js";
import * as selectionRepo from "./selection.repository.js";
import * as authService from "./auth.service.js";

export async function authRouter(
  app: FastifyInstance,
  opts: { sql: postgres.Sql },
): Promise<void> {
  const { sql } = opts;

  // POST /api/v1/patients — coordinator or admin creates a patient
  app.post<{ Body: { name?: string; clinic_id?: string } }>(
    "/api/v1/patients",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      const clinicId =
        caller.role === "coordinator"
          ? caller.clinic_id
          : (request.body.clinic_id ?? "");

      if (!clinicId) {
        return reply.status(400).send({ error: "clinic_id is required for admin" });
      }

      const patient = await patientRepo.create(sql, {
        clinicId,
        ...(request.body.name !== undefined ? { name: request.body.name } : {}),
        createdBy: caller.sub,
      });
      return reply.status(201).send(patient);
    },
  );

  // GET /api/v1/patients/:id/selection
  app.get<{ Params: { id: string } }>(
    "/api/v1/patients/:id/selection",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      const clinicId = caller.role === "coordinator" ? caller.clinic_id : undefined;

      const patient = await patientRepo.findById(sql, request.params.id, clinicId);
      if (!patient) return reply.status(404).send({ error: "Not found" });

      const selection = await selectionRepo.findByPatientId(sql, request.params.id);
      if (!selection) return reply.status(404).send({ error: "No selection for this patient" });

      return reply.send(selection);
    },
  );

  // PATCH /api/v1/patients/:id/selection — upsert embryo selection
  app.patch<{ Params: { id: string }; Body: { embryo_ids: string[] } }>(
    "/api/v1/patients/:id/selection",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      const clinicId = caller.role === "coordinator" ? caller.clinic_id : undefined;

      const patient = await patientRepo.findById(sql, request.params.id, clinicId);
      if (!patient) return reply.status(404).send({ error: "Not found" });

      const embryoIds: string[] = request.body.embryo_ids ?? [];

      try {
        const selection = await selectionRepo.updateEmbryoIds(
          sql,
          request.params.id,
          embryoIds,
          patient.clinic_id,
          caller.sub,
        );
        return reply.send(selection);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  // POST /api/v1/patients/:id/token — issue patient access token
  app.post<{ Params: { id: string }; Body: { ttl_days?: number } }>(
    "/api/v1/patients/:id/token",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      const clinicId = caller.role === "coordinator" ? caller.clinic_id : undefined;

      const patient = await patientRepo.findById(sql, request.params.id, clinicId);
      if (!patient) return reply.status(404).send({ error: "Not found" });

      const ttlDays = request.body.ttl_days ?? 30;
      if (ttlDays < 1 || ttlDays > 365) {
        return reply.status(400).send({ error: "ttl_days must be between 1 and 365" });
      }

      try {
        const result = await authService.issueToken(sql, {
          patientId: patient.id,
          clinicId: patient.clinic_id,
          issuedBy: caller.sub,
          ttlDays,
        });
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  // DELETE /api/v1/patients/:id/token — revoke patient access token
  app.delete<{ Params: { id: string } }>(
    "/api/v1/patients/:id/token",
    { preHandler: requireRole("coordinator", "admin") },
    async (request, reply) => {
      const caller = request.caller!;
      const clinicId = caller.role === "coordinator" ? caller.clinic_id : undefined;

      const patient = await patientRepo.findById(sql, request.params.id, clinicId);
      if (!patient) return reply.status(404).send({ error: "Not found" });

      await authService.revokeToken(sql, patient.id, caller.sub);
      return reply.status(204).send();
    },
  );
}
