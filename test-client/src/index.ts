import * as http from 'http';

const CHRONOTASK_API_URL = 'http://localhost:5000/api/v1';
let API_KEY = 'ct_live_acmedemo12345';

// State management for client-side self-healing
const taskBackoffs = new Map<string, number>(); // task_name -> timestamp until which it is suspended
const manuallySuspendedTasks = new Set<string>();
let stripeAttemptNumber = 1;

/**
 * Helper to submit telemetry data to ChronoTask AI using native fetch
 */
async function sendTelemetry(payload: {
  task_name: string;
  cron_expression: string;
  status: 'SUCCESS' | 'FAILED' | 'RETRYING';
  duration_ms: number;
  attempt_number: number;
  error_summary?: string;
  stack_trace?: string;
}) {
  try {
    const response = await fetch(`${CHRONOTASK_API_URL}/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`[Telemetry Ingestion Engine Alert] Ingest failed:`, data.error);
    } else {
      console.log(`[Telemetry Ingested] ${payload.task_name} -> Status: ${payload.status} (Execution ID: ${data.execution_id})`);
    }
  } catch (error: any) {
    console.error(`[Telemetry Transport Error] Cannot reach ChronoTask server:`, error.message);
  }
}

/**
 * Establishes a persistent Server-Sent Events (SSE) connection to listen for self-healing AI patches
 */
function connectToRemediationStream() {
  const streamUrl = `${CHRONOTASK_API_URL.replace('/api/v1', '')}/api/v1/dashboard/stream`;
  
  console.log(`[Self-Healing Engine] Connecting to ChronoTask AI SSE stream at: ${streamUrl}`);
  
  const req = http.get(streamUrl, (res) => {
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const rawJson = line.slice(6).trim();
          try {
            const event = JSON.parse(rawJson);
            if (event.type === 'REMEDIATION_CREATED') {
              applyRemediation(event.data);
            } else if (event.type === 'TASK_TOGGLED') {
              const task = event.data;
              if (task.status === 'SUSPENDED') {
                manuallySuspendedTasks.add(task.task_name);
                console.log(`[Self-Healing Engine] Task "${task.task_name}" status set to SUSPENDED. Suspending execution.`);
              } else {
                manuallySuspendedTasks.delete(task.task_name);
                console.log(`[Self-Healing Engine] Task "${task.task_name}" status set to ACTIVE. Resuming execution.`);
              }
            } else if (event.type === 'KEY_ROTATED') {
              const credentials = event.data;
              API_KEY = credentials.api_key;
              console.log(`\n[Self-Healing Engine] SRE API Key Rotated! Active simulator key updated in-memory to: ${API_KEY}\n`);
            }
          } catch (e) {
            // Ignore keep-alives or non-JSON payloads
          }
        }
      }
    });
  });

  req.on('error', (err) => {
    console.error(`[Self-Healing Engine] SSE stream connection lost. Retrying in 5s...`, err.message);
    setTimeout(connectToRemediationStream, 5000);
  });
}

/**
 * Applies self-healing instructions received from the AI diagnostics worker
 */
function applyRemediation(data: any) {
  console.log('\n======================================================================');
  console.log(`[SELF-HEALING PATCHeS RECEIVED] ChronoTask AI resolved a task failure!`);
  console.log(`- Task Name: ${data.task_name}`);
  console.log(`- Root Cause Analysis: ${data.root_cause_analysis}`);
  console.log(`- Recommended Action: ${data.action_taken}`);
  console.log(`- Retry Cooldown/Backoff: ${data.retry_delay_seconds || 30} seconds`);
  console.log(`- Suggested Code Patch: \n\n${data.suggested_fix}\n`);
  console.log('======================================================================\n');

  if (data.action_taken === 'DYNAMIC_BACKOFF') {
    const delaySec = data.retry_delay_seconds || 30;
    const suspendUntil = Date.now() + (delaySec * 1000);
    taskBackoffs.set(data.task_name, suspendUntil);
    console.log(`[Self-Healing Action] Dynamic backoff applied. Task "${data.task_name}" runs suspended until: ${new Date(suspendUntil).toLocaleTimeString()}`);
  }
}

/**
 * Checks if a task is currently suspended by the self-healing backoff logic
 */
function isTaskSuspended(taskName: string): boolean {
  if (manuallySuspendedTasks.has(taskName)) {
    console.log(`[Task Scheduler] "${taskName}" execution blocked: suspended by Admin in SRE Dashboard.`);
    return true;
  }

  const suspendUntil = taskBackoffs.get(taskName);
  if (!suspendUntil) return false;
  
  if (Date.now() < suspendUntil) {
    const remainingSec = Math.round((suspendUntil - Date.now()) / 1000);
    console.log(`[Task Scheduler] "${taskName}" run blocked by Active Dynamic Backoff (${remainingSec}s remaining).`);
    return true;
  }
  
  // Backoff expired
  taskBackoffs.delete(taskName);
  return false;
}

// ----------------------------------------------------
// JOB CLIENT TASK DEFINITIONS (Mock B2B Client Workloads)
// ----------------------------------------------------

// 1. Success Task: daily_report_generator
function runDailyReportGenerator() {
  console.log('\n[Task Trigger] Executing "daily_report_generator"...');
  
  if (isTaskSuspended('daily_report_generator')) {
    return;
  }
  
  // Simulating report generation
  const start = Date.now();
  setTimeout(async () => {
    const duration = Date.now() - start;
    await sendTelemetry({
      task_name: 'daily_report_generator',
      cron_expression: '0 2 * * *',
      status: 'SUCCESS',
      duration_ms: duration,
      attempt_number: 1
    });
  }, 200);
}

// 2. Failing/Healing Task: stripe_invoice_sync
function runStripeInvoiceSync() {
  console.log('\n[Task Trigger] Executing "stripe_invoice_sync"...');

  if (isTaskSuspended('stripe_invoice_sync')) {
    return;
  }

  const start = Date.now();
  setTimeout(async () => {
    const duration = Date.now() - start;

    if (stripeAttemptNumber < 3) {
      console.log(`[Execution Error] "stripe_invoice_sync" failed on attempt ${stripeAttemptNumber}`);
      await sendTelemetry({
        task_name: 'stripe_invoice_sync',
        cron_expression: '*/15 * * * *',
        status: 'FAILED',
        duration_ms: duration,
        attempt_number: stripeAttemptNumber,
        error_summary: 'StripeConnectionError: Connection timeout after 3000ms',
        stack_trace: 'StripeConnectionError: Connection timed out\n    at StripeAPI.request (/usr/src/client/stripe.js:24:9)\n    at async runStripeInvoiceSync (/usr/src/client/index.js:84:5)'
      });
      stripeAttemptNumber++;
    } else {
      console.log(`[Execution Success] "stripe_invoice_sync" succeeded on attempt ${stripeAttemptNumber} (Self-Healed)!`);
      await sendTelemetry({
        task_name: 'stripe_invoice_sync',
        cron_expression: '*/15 * * * *',
        status: 'SUCCESS',
        duration_ms: duration,
        attempt_number: stripeAttemptNumber
      });
      stripeAttemptNumber = 1; // Reset attempt number
    }
  }, 350);
}

// 3. Random Failure Task: image_processor
function runImageProcessor() {
  console.log('\n[Task Trigger] Executing "image_processor"...');

  if (isTaskSuspended('image_processor')) {
    return;
  }

  const start = Date.now();
  setTimeout(async () => {
    const duration = Date.now() - start;
    const isSuccess = Math.random() > 0.3; // 70% success, 30% failure

    if (isSuccess) {
      await sendTelemetry({
        task_name: 'image_processor',
        cron_expression: '0 * * * *',
        status: 'SUCCESS',
        duration_ms: duration,
        attempt_number: 1
      });
    } else {
      console.log(`[Execution Error] "image_processor" ran out of memory memory allocation failure.`);
      await sendTelemetry({
        task_name: 'image_processor',
        cron_expression: '0 * * * *',
        status: 'FAILED',
        duration_ms: duration,
        attempt_number: 1,
        error_summary: 'FatalError: JS heap out of memory',
        stack_trace: 'FatalError: JS heap out of memory\n    at ImageBuffer.resize (/usr/src/client/image.js:145:12)\n    at async runImageProcessor (/usr/src/client/index.js:112:5)'
      });
    }
  }, 600);
}

/**
 * Syncs the initial suspended tasks list from the backend
 */
async function fetchInitialSuspendedTasks() {
  try {
    const res = await fetch(`${CHRONOTASK_API_URL}/dashboard/tasks`);
    if (res.ok) {
      const tasks = await res.json() as any[];
      for (const t of tasks) {
        if (t.status === 'SUSPENDED') {
          manuallySuspendedTasks.add(t.task_name);
          console.log(`[Self-Healing Engine] Initial Sync: Task "${t.task_name}" is currently SUSPENDED.`);
        }
      }
    }
  } catch (err: any) {
    console.error(`[Self-Healing Engine] Failed to fetch initial task statuses:`, err.message);
  }
}

// ----------------------------------------------------
// RUNNER INITIALIZATION
// ----------------------------------------------------
console.log('========================================================');
console.log('ChronoTask AI B2B Client Simulator Running...');
console.log('Press Ctrl+C to terminate.');
console.log('========================================================\n');

// Start SSE stream client listener
connectToRemediationStream();

// Sync initial task statuses and then start scheduling
fetchInitialSuspendedTasks().then(() => {
  setInterval(runDailyReportGenerator, 10000); // every 10 seconds
  setInterval(runStripeInvoiceSync, 12000);     // every 12 seconds
  setInterval(runImageProcessor, 15000);         // every 15 seconds
});
