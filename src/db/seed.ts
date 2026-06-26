import { pool } from './pool';
import * as crypto from 'crypto';

async function seed() {
  try {
    console.log('[Seed] Seeding database...');

    // Clear existing data for a clean slate in test run
    await pool.query('TRUNCATE tenants CASCADE');

    const demoCompanyName = 'Acme Corp';
    const demoApiKey = 'ct_live_acmedemo12345';
    
    // Hash the API key matching auth middleware behavior
    const salt = process.env.API_KEY_SALT || '';
    const hashedKey = crypto
      .createHash('sha256')
      .update(demoApiKey + salt)
      .digest('hex');

    const insertTenant = await pool.query(
      `INSERT INTO tenants (company_name, api_key_hash)
       VALUES ($1, $2)
       RETURNING id, company_name, created_at`,
      [demoCompanyName, hashedKey]
    );

    const tenant = insertTenant.rows[0];
    console.log('[Seed] Successfully seeded Tenant!');
    console.log(`- ID: ${tenant.id}`);
    console.log(`- Company Name: ${tenant.company_name}`);
    console.log(`- Raw Test API Key: ${demoApiKey}`);
    console.log(`- Salt Used: "${salt}"`);
    console.log(`- Hashed API Key: ${hashedKey}`);
    console.log('\nUse this API key in your telemetry payload headers:');
    console.log(`x-api-key: ${demoApiKey}`);

  } catch (error) {
    console.error('[Seed] Error seeding database:', error);
  } finally {
    await pool.end();
  }
}

seed();
