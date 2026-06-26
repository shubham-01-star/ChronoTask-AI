import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Ensure dotenv is loaded before reading variables
dotenv.config();

const dbHost = process.env.DB_HOST || 'db';
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || 'postgres_dev_password';
const dbName = process.env.DB_NAME || 'chronotask_db';

export const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database client error:', err);
});
