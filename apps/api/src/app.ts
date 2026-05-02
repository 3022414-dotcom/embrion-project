import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import type postgres from "postgres";
import { embryoRouter } from "./modules/embryo/embryo.router.js";

export async function buildApp(opts: { sql: postgres.Sql; jwtSecret: string }) {
  const app = Fastify({ logger: false });

  await app.register(fastifyJwt, { secret: opts.jwtSecret });

  await app.register(embryoRouter, { sql: opts.sql });

  return app;
}
