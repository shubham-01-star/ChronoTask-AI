import { pool } from './pool';
import * as crypto from 'crypto';

async function createTenant() {
  const args = process.argv.slice(2);
  const companyNameArg = args.find(arg => arg.startsWith('--name='));
  
  let companyName = companyNameArg ? companyNameArg.split('=')[1] : '';

  if (!companyName) {
    console.error('Error: Please specify the company name using --name="Your Company Name"');
    console.error('Example: npm run tenant:create -- --name="My B2B Client"');
    process.exit(1);
  }

  try {
    console.log(`[Tenant CLI] Creating new tenant for "${companyName}"...`);

    // Generate a secure random 32-character hex key (16 bytes)
    const randomHex = crypto.randomBytes(16).toString('hex');
    const rawApiKey = `ct_live_${randomHex}`;
    
    // Hash the API key matching the auth middleware logic
    const salt = process.env.API_KEY_SALT || '';
    const hashedKey = crypto
      .createHash('sha256')
      .update(rawApiKey + salt)
      .digest('hex');

    const result = await pool.query(
      `INSERT INTO tenants (company_name, api_key_hash)
       VALUES ($1, $2)
       RETURNING id, company_name, created_at`,
      [companyName, hashedKey]
    );

    const tenant = result.rows[0];
    
    console.log('\n========================================================');
    console.log('🎉 TENANT CREATED SUCCESSFULLY!');
    console.log('========================================================');
    console.log(`Tenant ID:   ${tenant.id}`);
    console.log(`Company:     ${tenant.company_name}`);
    console.log(`Created At:  ${tenant.created_at}`);
    console.log(`API Access Token: ${rawApiKey}`);
    console.log('========================================================');
    console.log('⚠️  IMPORTANT: Store this token securely. It will not be shown again.');
    console.log('Use this token in your client SDK initialization / headers:\n');
    console.log(`x-api-key: ${rawApiKey}`);
    console.log('========================================================\n');

  } catch (error) {
    console.error('[Tenant CLI] Failed to create tenant:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createTenant();
