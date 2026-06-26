import { pool } from './pool';
import * as fs from 'fs';
import * as path from 'path';

async function initDatabase() {
  try {
    console.log('[Database Init] Reading schema.sql...');
    const schemaPath = path.join(__dirname, '../../schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('[Database Init] Executing schema SQL on target database...');
    await pool.query(sql);

    console.log('[Database Init] Database schema initialized successfully!');
  } catch (error) {
    console.error('[Database Init] Error initializing database schema:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
