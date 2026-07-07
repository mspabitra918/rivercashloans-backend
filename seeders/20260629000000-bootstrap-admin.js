'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');

// Bootstraps the first back-office admin so the underwriting portal is
// reachable right after migrating. Credentials come from ADMIN_EMAIL /
// ADMIN_PASSWORD / ADMIN_NAME, falling back to the defaults below.
//
// Idempotent AND self-healing: re-running upserts on the unique email, so
// editing the password here (or in env) and re-seeding actually updates the
// existing row's hash — unlike a plain insert with ignoreDuplicates, which
// would silently keep the original password.
module.exports = {
  async up(queryInterface) {
    const email = process.env.ADMIN_EMAIL || 'admin@rivercashloans.com';
    const password = process.env.ADMIN_PASSWORD || 'admin!!1234';
    const name = process.env.ADMIN_NAME || 'River Cash Loans Admin';
    if (!email || !password) {
      // Nothing to seed without bootstrap credentials — skip silently.
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    // Postgres upsert: insert, or update the existing row on email conflict so
    // the stored hash always matches the current password.
    await queryInterface.sequelize.query(
      `INSERT INTO admins (name, email, password_hash, role)
       VALUES (:name, :email, :passwordHash, 'admin')
       ON CONFLICT (email)
       DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role`,
      { replacements: { name, email, passwordHash } },
    );
  },

  async down(queryInterface) {
    const email = process.env.ADMIN_EMAIL || 'admin@rivercashloans.com';
    if (!email) return;
    await queryInterface.bulkDelete('admins', { email }, {});
  },
};
