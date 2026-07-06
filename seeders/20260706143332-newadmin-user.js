'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');

// Bootstraps the first back-office admin from ADMIN_EMAIL / ADMIN_PASSWORD so
// the underwriting portal is reachable right after migrating. Idempotent:
// re-running won't create a duplicate (email is unique + ignoreDuplicates).
module.exports = {
  async up(queryInterface) {
    const email = process.env.ADMIN_EMAIL || 'admindavid@oakhillloans.com';
    const password = process.env.ADMIN_PASSWORD || 'david__oakhillloans!!';
    if (!email || !password) {
      // Nothing to seed without bootstrap credentials — skip silently.
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    await queryInterface.bulkInsert(
      'admins',
      [
        {
          name: process.env.ADMIN_NAME || 'David',
          email,
          password_hash: passwordHash,
          role: 'admin',
        },
      ],
      { ignoreDuplicates: true },
    );
  },

  async down(queryInterface) {
    const email = process.env.ADMIN_EMAIL;
    if (!email) return;
    await queryInterface.bulkDelete('admins', { email }, {});
  },
};
