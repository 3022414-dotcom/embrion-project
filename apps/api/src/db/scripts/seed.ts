import bcrypt from 'bcryptjs';
import postgres from 'postgres';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function seed() {
  const hash = await bcrypt.hash('password123', 12);

  const accounts = [
    {
      email: 'coordinator@clinic.test',
      role: 'coordinator',
      clinic_id: 'clinic-001',
    },
    {
      email: 'admin@clinic.test',
      role: 'admin',
      clinic_id: null as string | null,
    },
  ];

  for (const account of accounts) {
    const result = await sql`
      INSERT INTO users (email, password_hash, role, clinic_id, is_active)
      VALUES (
        ${account.email},
        ${hash},
        ${account.role},
        ${account.clinic_id},
        true
      )
      ON CONFLICT (email) DO NOTHING
    `;
    const inserted = (result as { count: number }).count;
    if (inserted > 0) {
      console.log(`seeded: ${account.email} (${account.role})`);
    } else {
      console.log(`skipped (already exists): ${account.email}`);
    }
  }

  await sql.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
