import postgres from "postgres";
import { buildApp } from "./app.js";

const sql = postgres(process.env["DATABASE_URL"] ?? "postgresql://localhost/embrion");

const app = await buildApp({
  sql,
  jwtSecret: process.env["JWT_SECRET"] ?? "change-me-in-production",
});

const port = Number(process.env["PORT"] ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API running on port ${port}`);
