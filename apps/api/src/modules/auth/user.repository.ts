import type postgres from 'postgres';

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  role: 'coordinator' | 'admin';
  clinicId: string | null;
  isActive: boolean;
  createdAt: Date;
};

export type UserActiveStatus = {
  isActive: boolean;
};

export async function findByEmail(
  sql: postgres.Sql,
  email: string,
): Promise<User | null> {
  const normalised = email.toLowerCase();
  const rows = await sql<{
    id: string;
    email: string;
    password_hash: string;
    role: 'coordinator' | 'admin';
    clinic_id: string | null;
    is_active: boolean;
    created_at: Date;
  }[]>`
    SELECT id, email, password_hash, role, clinic_id, is_active, created_at
    FROM users
    WHERE email = ${normalised}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    clinicId: row.clinic_id,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function findById(
  sql: postgres.Sql,
  id: string,
): Promise<UserActiveStatus | null> {
  const rows = await sql<{ is_active: boolean }[]>`
    SELECT is_active
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { isActive: row.is_active };
}
