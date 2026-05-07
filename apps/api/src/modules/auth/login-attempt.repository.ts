import type postgres from 'postgres';

export async function countRecent(
  sql: postgres.Sql,
  email: string,
  windowMinutes: number,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM login_attempts
    WHERE email = ${email}
      AND occurred_at > NOW() - ${windowMinutes} * INTERVAL '1 minute'
  `;
  const count = rows[0]?.count ?? '0';
  return parseInt(count, 10);
}

export async function record(
  sql: postgres.Sql,
  email: string,
): Promise<void> {
  await sql`
    INSERT INTO login_attempts (email)
    VALUES (${email})
  `;
}

export async function clearByEmail(
  sql: postgres.Sql,
  email: string,
): Promise<void> {
  await sql`
    DELETE FROM login_attempts
    WHERE email = ${email}
  `;
}
