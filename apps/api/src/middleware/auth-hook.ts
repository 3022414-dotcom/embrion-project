import type { FastifyRequest, FastifyReply } from "fastify";
import type postgres from "postgres";
import * as authService from "../modules/auth/auth.service.js";
import * as userRepository from "../modules/auth/user.repository.js";

export type CallerContext =
  | { role: "coordinator"; sub: string; clinic_id: string }
  | { role: "admin"; sub: string; clinic_id?: string }
  | { role: "patient"; sub: string; clinic_id: string; selection_id: string; embryo_ids: string[] };

declare module "fastify" {
  interface FastifyRequest {
    caller?: CallerContext;
  }
}

export type AuthHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const PUBLIC_PATHS = new Set(["/api/v1/auth/login"]);

export function buildAuthHook(sql: postgres.Sql): AuthHook {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.has(request.url)) return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);

    // Try JWT first (coordinator / admin path — zero DB hits)
    try {
      await request.jwtVerify();
      const claims = request.user as {
        sub: string;
        role: "coordinator" | "admin";
        clinic_id?: string;
        iat?: number;
        exp?: number;
      };
      const roleClaim = (claims as unknown as { role: string }).role;

      if (roleClaim === "coordinator" || roleClaim === "admin") {
        // F-03: check is_active on every coordinator/admin request
        const userStatus = await userRepository.findById(sql, claims.sub);
        if (!userStatus || !userStatus.isActive) {
          return reply.status(401).send({ error: "Unauthorized" });
        }

        if (roleClaim === "coordinator") {
          request.caller = {
            role: "coordinator",
            sub: claims.sub,
            // Fall back to "default-clinic" for legacy test tokens without clinic_id
            clinic_id: claims.clinic_id ?? "default-clinic",
          };
        } else {
          request.caller = {
            role: "admin",
            sub: claims.sub,
            ...(claims.clinic_id !== undefined ? { clinic_id: claims.clinic_id } : {}),
          };
        }
        return;
      }

      // Unknown or non-coordinator/admin role in JWT — fall through to opaque token path
      throw new Error("unrecognized JWT role");
    } catch {
      // Not a valid JWT — try opaque patient token
    }

    const ipAddress =
      (request.headers["x-forwarded-for"] as string | undefined) ?? request.ip;
    const result = await authService.validatePatientToken(sql, token, ipAddress);

    if (result.status === "valid") {
      request.caller = result.caller;
      return;
    }
    if (result.status === "expired") {
      return reply.status(401).send({ error: "token_expired" });
    }
    return reply.status(401).send({ error: "Unauthorized" });
  };
}
