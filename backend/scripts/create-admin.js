require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const pool   = require('../src/config/db');

async function main() {
  const email    = process.env.ADMIN_EMAIL    || 'admin@printq.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@1234';
  const name     = process.env.ADMIN_NAME     || 'PrintQ Admin';
  const role     = process.env.ADMIN_ROLE     || 'superadmin';
  const college  = process.env.DEFAULT_COLLEGE_ID || 'col_default';

  console.log(`\n Creating admin: ${email} | ${role} | ${college}\n`);

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const { rows } = await pool.query(
      `INSERT INTO admins (college_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (college_id, email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             name          = EXCLUDED.name,
             role          = EXCLUDED.role,
             updated_at    = NOW()
       RETURNING id, email, role`,
      [college, email, passwordHash, name, role]
    );
    console.log('Admin created:', rows[0]);
    console.log(`\nLogin: ${email} / ${password}\n`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
