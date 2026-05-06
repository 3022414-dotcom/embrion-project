import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import type postgres from "postgres";
import { embryoRouter } from "./modules/embryo/embryo.router.js";
import { authRouter } from "./modules/auth/auth.router.js";
import { buildAuthHook } from "./middleware/auth-hook.js";

export async function buildApp(opts: { sql: postgres.Sql; jwtSecret: string }) {
  const app = Fastify({ logger: false });

  await app.register(fastifyJwt, { secret: opts.jwtSecret });

  app.addHook("onRequest", buildAuthHook(opts.sql));

  await app.register(embryoRouter, { sql: opts.sql });
  await app.register(authRouter, { sql: opts.sql });

  return app;
}
