/**
 * Apply RLS policies and pgvector ANN indexes.
 * Run AFTER `prisma migrate deploy` (or as part of `npm run prisma:deploy`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  const files = [
    join(__dirname, '..', 'sql', 'rls.sql'),
    join(__dirname, '..', 'sql', 'invitations.sql'),
    join(__dirname, '..', 'sql', 'vector_index.sql'),
  ];

  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    console.log(`▶ Applying ${f}`);
    await client.query(sql);
  }

  await client.end();
  console.log('✅ RLS + vector index applied');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
