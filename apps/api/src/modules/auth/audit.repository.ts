import type postgres from "postgres";

export type AuditEvent =
  | "issued"
  | "used"
  | "revoked"
  | "expired"
  | "expired_attempt"
  | "unauthorized_attempt";

type Sql = postgres.Sql;

export async function logEvent(
  sql: Sql,
  entry: {
    tokenId?: string;
    event: AuditEvent;
    actorId?: string;
    actorRole?: string;
    ipAddress?: string;
  },
): Promise<void> {
  try {
    await sql`
      INSERT INTO token_audit_log (token_id, event, actor_id, actor_role, ip_address)
      VALUES (
        ${entry.tokenId ?? null},
        ${entry.event},
        ${entry.actorId ?? null},
        ${entry.actorRole ?? null},
        ${entry.ipAddress ?? null}
      )
    `;
  } catch (err) {
    console.error("[audit] Failed to log event:", err);
  }
}
