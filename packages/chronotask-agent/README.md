# @shubham-01-star/chronotask-agent

A zero-dependency Node.js and TypeScript client SDK for integrating scheduled cron jobs, background workers, and queue runners with the **ChronoTask AI Self-Healing SRE Platform**.

It provides automatic telemetry logging, admin-controlled execution suspension, dynamic AI-driven backoffs, and zero-downtime secret API key rotation out-of-the-box.

---

## 📦 Installation

Install the package via npm:

```bash
npm install @shubham-01-star/chronotask-agent
```

---

## ⚡ Quick Start

Here is how you can initialize the agent, report task execution status, and set up the self-healing event stream.

```typescript
import { ChronoTaskAgent } from '@shubham-01-star/chronotask-agent';

// Initialize the ChronoTask Agent
const agent = new ChronoTaskAgent({
  apiKey: 'ct_live_your_sre_access_token_here',
  endpoint: 'http://localhost:5000/api/v1', // Your self-hosted ChronoTask AI endpoint
  enableSelfHealing: true // Set to false to disable SSE stream listeners
});

// Example: Wrap your cron job logic
async function runDatabaseBackup() {
  const taskName = 'customer_database_backup';
  
  // 1. Check if the task is suspended by the SRE dashboard or active dynamic backoffs
  if (agent.isSuspended(taskName)) {
    const remainingCooldown = agent.getRemainingBackoffSeconds(taskName);
    console.warn(`[Scheduler] Task "${taskName}" execution blocked. Cooldown remaining: ${remainingCooldown}s`);
    return;
  }

  const startTime = Date.now();
  try {
    console.log(`[Job] Executing backup...`);
    
    // ---> Place your job code here <---
    
    // 2. Report Success Telemetry
    await agent.report({
      task_name: taskName,
      cron_expression: '0 2 * * *', // Daily at 2:00 AM
      status: 'SUCCESS',
      duration_ms: Date.now() - startTime,
      attempt_number: 1
    });
    console.log('[Job] Telemetry success reported.');

  } catch (error: any) {
    console.error('[Job] Execution failed:', error.message);
    
    // 3. Report Failure Telemetry (triggers asynchronous Gemini AI diagnostics)
    await agent.report({
      task_name: taskName,
      cron_expression: '0 2 * * *',
      status: 'FAILED',
      duration_ms: Date.now() - startTime,
      attempt_number: 1,
      error_summary: error.message,
      stack_trace: error.stack
    });
  }
}
```

---

## 🌀 Self-Healing Event Listeners

When `enableSelfHealing` is active, the agent automatically connects to the server stream and updates its internal blacklist and cooldown timers in real-time. You can listen to these events to customize logging or apply custom rules:

### 1. AI Remediations & Backoffs
Triggered when Gemini AI finishes analyzing a failure and recommends a dynamic backoff/patch:
```typescript
agent.onRemediation((data) => {
  console.log(`[AI Alert] Recommended Action: ${data.action_taken}`);
  console.log(`[AI Alert] Suggested Fix: \n${data.suggested_fix}`);
});
```

### 2. Administrative Suspensions
Triggered when an SRE/Administrator toggles the status of a queue directly from the ChronoTask AI dashboard:
```typescript
agent.onTaskToggled((task) => {
  console.log(`[Admin Alert] Task "${task.task_name}" status set to ${task.status}`);
});
```

### 3. Credentials Rotation
Triggered when you rotate keys on the dashboard. The client synchronizes the new key in-memory instantly, maintaining zero-downtime ingestion:
```typescript
agent.onKeyRotated((newKey) => {
  console.log(`[Auth Alert] Telemetry API Key rotated to: ${newKey}`);
});
```

---

## 📖 API Reference

### `new ChronoTaskAgent(config: ChronoTaskAgentConfig)`
Instantiates a new ChronoTask SRE client agent.
*   `apiKey` (string, required): Developer access key obtained from Settings panel.
*   `endpoint` (string, optional): Base telemetry API URL. Defaults to `http://localhost:5000/api/v1`.
*   `enableSelfHealing` (boolean, optional): Connects to the SSE stream to handle events in-memory. Defaults to `true`.

### `agent.report(payload: TelemetryPayload): Promise<{ success: boolean; execution_id?: string; error?: string }>`
Ingests execution telemetry. Triggers AI diagnostic queue automatically if status is `'FAILED'`.

### `agent.isSuspended(taskName: string): boolean`
Returns `true` if the task is currently suspended by an administrator or under active dynamic backoff cooldown.

### `agent.getRemainingBackoffSeconds(taskName: string): number`
Returns the remaining cooldown duration in seconds for tasks undergoing dynamic backoffs.

### `agent.disconnect()`
Gracefully closes the persistent SSE connection stream.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
