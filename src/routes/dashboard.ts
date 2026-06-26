import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { dashboardEvents, EVENTS } from '../services/events';

const router = Router();

/**
 * GET /api/v1/dashboard/metrics
 * Fetches high-level telemetry statistics and recent AI patches.
 */
router.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Fetch total tasks count
    const tasksCountRes = await pool.query('SELECT COUNT(*)::int as count FROM cron_tasks');
    const totalTasks = tasksCountRes.rows[0]?.count || 0;

    // 2. Fetch total executions and failed executions count
    const executionStatsRes = await pool.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN status = 'FAILED' THEN 1 END)::int as failed
      FROM task_executions
    `);
    const totalExecutions = executionStatsRes.rows[0]?.total || 0;
    const failedExecutions = executionStatsRes.rows[0]?.failed || 0;

    // Calculate failure rate percentage
    const failureRate = totalExecutions > 0 
      ? parseFloat(((failedExecutions / totalExecutions) * 100).toFixed(2)) 
      : 0;

    // 3. Fetch latest 5 AI remediations
    const remediationsRes = await pool.query(`
      SELECT r.id, r.root_cause_analysis, r.suggested_fix, r.action_taken, r.created_at,
             e.id as execution_id, e.error_summary, t.task_name
      FROM ai_remediations r
      JOIN task_executions e ON r.execution_id = e.id
      JOIN cron_tasks t ON e.task_id = t.id
      ORDER BY r.created_at DESC
      LIMIT 10
    `);

    res.json({
      metrics: {
        total_tasks: totalTasks,
        total_executions: totalExecutions,
        failed_executions: failedExecutions,
        failure_rate: failureRate,
      },
      recent_remediations: remediationsRes.rows,
    });
  } catch (error) {
    console.error('Error fetching dashboard metrics:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/v1/dashboard/stream
 * Opens a Server-Sent Events (SSE) connection to stream telemetry and AI remediation logs.
 */
router.get('/stream', (req: Request, res: Response) => {
  // Set headers for Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*', // Enable CORS for SSE
  });

  // Send initial handshake event
  res.write('data: ' + JSON.stringify({ type: 'CONNECTED', message: 'SSE Stream Established' }) + '\n\n');

  // Callback functions to handle events
  const onTelemetryIngested = (data: any) => {
    res.write('data: ' + JSON.stringify({ type: 'TELEMETRY_INGESTED', data }) + '\n\n');
  };

  const onRemediationCreated = (data: any) => {
    res.write('data: ' + JSON.stringify({ type: 'REMEDIATION_CREATED', data }) + '\n\n');
  };

  // Subscribe to internal events
  dashboardEvents.on(EVENTS.TELEMETRY_INGESTED, onTelemetryIngested);
  dashboardEvents.on(EVENTS.REMEDIATION_CREATED, onRemediationCreated);

  // Send periodic keep-alive pings to prevent timeout
  const keepAliveInterval = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  // Handle client disconnection (prevent memory leaks!)
  req.on('close', () => {
    console.log('[SSE Stream] Client disconnected. Cleaning up event listeners.');
    clearInterval(keepAliveInterval);
    dashboardEvents.off(EVENTS.TELEMETRY_INGESTED, onTelemetryIngested);
    dashboardEvents.off(EVENTS.REMEDIATION_CREATED, onRemediationCreated);
    res.end();
  });
});

export default router;
