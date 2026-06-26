import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { authenticateApiKey } from '../middleware/auth';
import { runAIDiagnostics } from '../services/ai';
import { dashboardEvents, EVENTS } from '../services/events';

const router = Router();

// Apply auth middleware to all telemetry routes
router.use(authenticateApiKey);

/**
 * POST /api/v1/telemetry
 * Ingests telemetry logs from a cron task / job runner.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = req.tenant;
    if (!tenant) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      task_name,
      cron_expression,
      status,
      duration_ms,
      error_summary,
      stack_trace,
      attempt_number = 1,
    } = req.body;

    // Validate parameters
    if (!task_name || !cron_expression || !status || duration_ms === undefined) {
      res.status(400).json({
        error: 'Bad Request: Missing required fields (task_name, cron_expression, status, duration_ms)',
      });
      return;
    }

    // Validate status values
    const validStatuses = ['SUCCESS', 'FAILED', 'RETRYING'];
    if (!validStatuses.includes(status.toUpperCase())) {
      res.status(400).json({
        error: `Bad Request: Status must be one of: ${validStatuses.join(', ')}`,
      });
      return;
    }

    // 1. Get or Create the cron_task
    const taskUpsert = await pool.query(
      `INSERT INTO cron_tasks (tenant_id, task_name, cron_expression)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, task_name) 
       DO UPDATE SET cron_expression = EXCLUDED.cron_expression
       RETURNING id, max_retries`,
      [tenant.id, task_name, cron_expression]
    );

    const task = taskUpsert.rows[0];

    // 2. Insert execution log
    const execInsert = await pool.query(
      `INSERT INTO task_executions (task_id, status, duration_ms, error_summary, stack_trace, attempt_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, triggered_at`,
      [task.id, status.toUpperCase(), duration_ms, error_summary || null, stack_trace || null, attempt_number]
    );

    const execution = execInsert.rows[0];

    // 3. Emit event to live stream dashboard
    dashboardEvents.emit(EVENTS.TELEMETRY_INGESTED, {
      id: execution.id,
      tenant_id: tenant.id,
      company_name: tenant.company_name,
      task_id: task.id,
      task_name,
      status: status.toUpperCase(),
      duration_ms,
      error_summary: error_summary || null,
      attempt_number,
      triggered_at: execution.triggered_at,
    });

    // 4. Asynchronous AI Diagnostics loop if status is FAILED
    if (status.toUpperCase() === 'FAILED') {
      // Fire-and-forget: do NOT await this promise so the HTTP thread remains unblocked!
      runAIDiagnostics(execution.id).catch((err) => {
        console.error(`[Telemetry Ingest] Background AI analysis failed:`, err);
      });
    }

    res.status(201).json({
      success: true,
      message: 'Telemetry logged successfully',
      execution_id: execution.id,
      ai_diagnostics_triggered: status.toUpperCase() === 'FAILED',
    });
  } catch (error) {
    console.error('Error in telemetry route:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
