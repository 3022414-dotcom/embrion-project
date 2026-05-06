import type { FastifyRequest, FastifyReply } from "fastify";
import type { Role } from "@embrion/schema";

export type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function requireRole(...allowed: Role[]): PreHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.caller?.role;
    if (!role || !(allowed as string[]).includes(role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
  };
}
