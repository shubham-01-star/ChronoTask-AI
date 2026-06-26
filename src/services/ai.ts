import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { pool } from '../db/pool';
import { dashboardEvents, EVENTS } from './events';

// Initialize Gemini API client
const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

// Define structured JSON schema for Gemini output
const remediationSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    root_cause: {
      type: SchemaType.STRING,
      description: "Detailed analysis of the root cause of the error.",
    },
    suggested_patch: {
      type: SchemaType.STRING,
      description: "A concrete code change or patch recommendation to resolve the failure.",
    },
    recommended_action: {
      type: SchemaType.STRING,
      enum: ["DYNAMIC_BACKOFF", "CIRCUIT_BREAKER"],
      description: "Action type to mitigate the issue.",
    },
    retry_delay_seconds: {
      type: SchemaType.INTEGER,
      description: "Delay duration recommendations in seconds.",
    },
  },
  required: ["root_cause", "suggested_patch", "recommended_action", "retry_delay_seconds"],
};

/**
 * Triggers asynchronous AI diagnostics for a failed execution.
 * This runs out-of-band and does not block the API client thread.
 */
export async function runAIDiagnostics(executionId: string): Promise<void> {
  try {
    console.log(`[AI Service] Starting diagnostics for execution ID: ${executionId}`);

    // 1. Fetch execution context and task details
    const executionQuery = await pool.query(
      `SELECT e.id as execution_id, e.error_summary, e.stack_trace, e.attempt_number, e.triggered_at,
              t.id as task_id, t.task_name, t.cron_expression, t.max_retries
       FROM task_executions e
       JOIN cron_tasks t ON e.task_id = t.id
       WHERE e.id = $1 LIMIT 1`,
      [executionId]
    );

    if (executionQuery.rowCount === 0) {
      console.error(`[AI Service] Execution ${executionId} not found in database.`);
      return;
    }

    const exec = executionQuery.rows[0];

    // 2. Fetch past 24-hour failure trends and recent logs for trend analysis
    const trendQuery = await pool.query(
      `SELECT status, COUNT(*) as count
       FROM task_executions
       WHERE task_id = $1 AND triggered_at >= NOW() - INTERVAL '24 hours'
       GROUP BY status`,
      [exec.task_id]
    );

    const recentFailuresQuery = await pool.query(
      `SELECT error_summary, triggered_at
       FROM task_executions
       WHERE task_id = $1 AND status = 'FAILED' AND id != $2 AND triggered_at >= NOW() - INTERVAL '24 hours'
       ORDER BY triggered_at DESC
       LIMIT 3`,
      [exec.task_id, executionId]
    );

    // Format metrics trends
    let successCount = 0;
    let failureCount = 0;
    let retryingCount = 0;
    for (const row of trendQuery.rows) {
      if (row.status === 'SUCCESS') successCount = parseInt(row.count, 10);
      if (row.status === 'FAILED') failureCount = parseInt(row.count, 10);
      if (row.status === 'RETRYING') retryingCount = parseInt(row.count, 10);
    }

    const recentFailuresList = recentFailuresQuery.rows
      .map((f, i) => `[${i + 1}] At ${f.triggered_at.toISOString()}: ${f.error_summary}`)
      .join('\n');

    // 3. Construct deterministic prompt
    const prompt = `
You are an autonomous Site Reliability Engineering (SRE) agent.
Analyze the following runtime failure for a background task and output a strict JSON remediation plan.

--- TASK DETAILS ---
Task Name: ${exec.task_name}
Cron Expression: ${exec.cron_expression}
Max Configured Retries: ${exec.max_retries}

--- FAILURE TELEMETRY ---
Execution ID: ${exec.execution_id}
Attempt Number: ${exec.attempt_number}
Timestamp: ${exec.triggered_at.toISOString()}
Error Summary: ${exec.error_summary || 'N/A'}
Stack Trace:
${exec.stack_trace || 'No stack trace provided'}

--- PAST 24-HOUR TRENDS FOR THIS TASK ---
- Successes: ${successCount}
- Failures: ${failureCount} (excluding this one)
- Retrying States: ${retryingCount}

--- RECENT FAILURES ---
${recentFailuresList || 'No other failures recorded in the past 24 hours.'}

Provide your analysis in the required JSON schema format.
`;

    // 4. Invoke Gemini API with schema constraint, with mock fallback if key is missing/invalid
    let diagnostics;
    try {
      if (!apiKey || apiKey.includes('your_gemini_api_key')) {
        throw new Error('API key is not configured or is a placeholder.');
      }

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: remediationSchema,
        },
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      // Parse response output
      diagnostics = JSON.parse(responseText);
    } catch (apiError: any) {
      console.warn(`[AI Service] Gemini API call bypassed/failed. Falling back to simulated remediation. Info: ${apiError.message}`);
      diagnostics = {
        root_cause: `[SIMULATED] Connection timeout on Stripe API invoice synchronization attempt ${exec.attempt_number}.`,
        suggested_patch: `// Workaround: Introduce an explicit timeout option on Stripe client initialization\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {\n  timeout: 10000,\n  maxNetworkRetries: 3\n});`,
        recommended_action: "DYNAMIC_BACKOFF",
        retry_delay_seconds: 30 * exec.attempt_number
      };
    }

    // 5. Store AI diagnostics into 'ai_remediations'
    const insertResult = await pool.query(
      `INSERT INTO ai_remediations (execution_id, root_cause_analysis, suggested_fix, action_taken)
       VALUES ($1, $2, $3, $4)
       RETURNING id, root_cause_analysis, suggested_fix, action_taken, created_at`,
      [
        executionId,
        diagnostics.root_cause,
        diagnostics.suggested_patch,
        diagnostics.recommended_action,
      ]
    );

    const remediation = insertResult.rows[0];
    console.log(`[AI Service] Saved remediation ID: ${remediation.id}`);

    // 6. Broadcast remediation event to active SSE streams
    dashboardEvents.emit(EVENTS.REMEDIATION_CREATED, {
      id: remediation.id,
      execution_id: executionId,
      task_name: exec.task_name,
      root_cause_analysis: remediation.root_cause_analysis,
      suggested_fix: remediation.suggested_fix,
      action_taken: remediation.action_taken,
      created_at: remediation.created_at,
      retry_delay_seconds: diagnostics.retry_delay_seconds,
    });

  } catch (error) {
    console.error(`[AI Service] Error analyzing failure for execution ID ${executionId}:`, error);
  }
}
