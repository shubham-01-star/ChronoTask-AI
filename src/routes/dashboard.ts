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

  const onTaskToggled = (data: any) => {
    res.write('data: ' + JSON.stringify({ type: 'TASK_TOGGLED', data }) + '\n\n');
  };

  // Subscribe to internal events
  dashboardEvents.on(EVENTS.TELEMETRY_INGESTED, onTelemetryIngested);
  dashboardEvents.on(EVENTS.REMEDIATION_CREATED, onRemediationCreated);
  dashboardEvents.on(EVENTS.TASK_TOGGLED, onTaskToggled);

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
    dashboardEvents.off(EVENTS.TASK_TOGGLED, onTaskToggled);
    res.end();
  });
});

/**
 * GET /api/v1/dashboard/tasks
 * Lists all registered cron tasks with execution statistics.
 */
router.get('/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.task_name, t.cron_expression, t.max_retries, t.status, t.created_at,
             COUNT(e.id)::int as total_executions,
             COUNT(CASE WHEN e.status = 'SUCCESS' THEN 1 END)::int as success_count,
             COUNT(CASE WHEN e.status = 'FAILED' THEN 1 END)::int as failure_count
      FROM cron_tasks t
      LEFT JOIN task_executions e ON t.id = e.task_id
      GROUP BY t.id
      ORDER BY t.task_name ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dashboard tasks list:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/v1/dashboard/tasks/:id/toggle
 * Suspends or activates a cron task in the system.
 */
router.post('/tasks/:id/toggle', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Get current status
    const statusRes = await pool.query('SELECT status FROM cron_tasks WHERE id = $1 LIMIT 1', [id]);
    if (statusRes.rowCount === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    
    const currentStatus = statusRes.rows[0].status;
    const nextStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    
    const updateRes = await pool.query(
      'UPDATE cron_tasks SET status = $1 WHERE id = $2 RETURNING id, task_name, status',
      [nextStatus, id]
    );
    
    // Emit task toggled event to notify SSE clients (e.g. client simulator)
    dashboardEvents.emit(EVENTS.TASK_TOGGLED, updateRes.rows[0]);
    
    res.json({ success: true, task: updateRes.rows[0] });
  } catch (error) {
    console.error('Error toggling task status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/v1/dashboard/remediations
 * Lists all historical AI diagnostics and self-healing patches.
 */
router.get('/remediations', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.root_cause_analysis, r.suggested_fix, r.action_taken, r.created_at,
             e.id as execution_id, e.error_summary, t.task_name, t.cron_expression
      FROM ai_remediations r
      JOIN task_executions e ON r.execution_id = e.id
      JOIN cron_tasks t ON e.task_id = t.id
      ORDER BY r.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dashboard remediations:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/v1/dashboard/db-stats
 * Pulls live database metrics directly from PostgreSQL pg_class and pg_stat catalogs.
 */
router.get('/db-stats', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Connection count
    const connRes = await pool.query("SELECT COUNT(*)::int as count FROM pg_stat_activity");
    const activeConnections = connRes.rows[0]?.count || 0;

    // 2. Table sizes
    const sizeRes = await pool.query(`
      SELECT 
        relname AS table_name, 
        pg_total_relation_size(class.oid)::bigint AS size_bytes,
        pg_size_pretty(pg_total_relation_size(class.oid)) AS size_pretty
      FROM pg_class class
      JOIN pg_namespace ns ON ns.oid = class.relnamespace
      WHERE relkind = 'r' AND ns.nspname = 'public'
      ORDER BY pg_total_relation_size(class.oid) DESC
    `);
    const tables = sizeRes.rows;

    // 3. Cache Hit Ratio
    const cacheRes = await pool.query(`
      SELECT 
        COALESCE(sum(heap_blks_read), 0)::bigint as heap_read,
        COALESCE(sum(heap_blks_hit), 0)::bigint as heap_hit
      FROM pg_statio_user_tables
    `);
    const heapRead = parseInt(cacheRes.rows[0]?.heap_read || '0', 10);
    const heapHit = parseInt(cacheRes.rows[0]?.heap_hit || '0', 10);
    const cacheHitRatio = (heapRead + heapHit) > 0 
      ? parseFloat(((heapHit / (heapRead + heapHit)) * 100).toFixed(2))
      : 100.0;

    res.json({
      active_connections: activeConnections,
      tables,
      cache_hit_ratio: cacheHitRatio,
    });
  } catch (error) {
    console.error('Error fetching DB stats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/v1/dashboard/tenant
 * Returns the profile of the seeded B2B tenant.
 */
router.get('/tenant', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query('SELECT id, company_name, created_at, api_key_hash FROM tenants LIMIT 1');
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'No tenant found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching tenant details:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
