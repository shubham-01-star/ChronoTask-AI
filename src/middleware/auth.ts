import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import * as crypto from 'crypto';

// Extend Express Request type to include tenant information
declare global {
  namespace Express {
    interface Request {
      tenant?: {
        id: string;
        company_name: string;
      };
    }
  }
}

export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(401).json({ error: 'Unauthorized: Missing API Key' });
      return;
    }

    // Retrieve salt from environment
    const salt = process.env.API_KEY_SALT || '';

    // Calculate SHA-256 hash of the API key, incorporating the salt
    const hashedKey = crypto
      .createHash('sha256')
      .update(apiKey + salt)
      .digest('hex');

    // Query database for tenant matching this hashed API key
    const queryResult = await pool.query(
      'SELECT id, company_name FROM tenants WHERE api_key_hash = $1 LIMIT 1',
      [hashedKey]
    );

    if (queryResult.rowCount === 0) {
      res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
      return;
    }

    const tenant = queryResult.rows[0];

    // Attach tenant info to request object
    req.tenant = {
      id: tenant.id,
      company_name: tenant.company_name,
    };

    next();
  } catch (error) {
    console.error('Error in authenticateApiKey middleware:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
