require('dotenv').config();

// sequelize-cli config. Reads the same DB_* variables the NestJS runtime uses
// (see config/database.config.ts) so migrations, seeders, and the app all hit
// the same database. Prefer a single DATABASE_URL when one is provided.
const useUrl = !!process.env.DATABASE_URL;

const dialectOptions =
  process.env.DB_SSL === 'true'
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : undefined;

const fromEnv = {
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'rivercash_loans',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  dialect: 'postgres',
  dialectOptions,
};

const fromUrl = {
  use_env_variable: 'DATABASE_URL',
  dialect: 'postgres',
  dialectOptions,
};

const base = useUrl ? fromUrl : fromEnv;

module.exports = {
  development: base,
  test: base,
  production: base,
};
