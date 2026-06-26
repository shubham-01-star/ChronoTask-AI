# 🌀 ChronoTask AI Client Agent SDK

[![NPM Version](https://img.shields.io/npm/v/@shubham-01-star/chronotask-agent.svg?style=flat-rounded&color=007acc)](https://www.npmjs.com/package/@shubham-01-star/chronotask-agent)
[![Bundle Size](https://img.shields.io/bundlephobia/min/@shubham-01-star/chronotask-agent?color=31c653)](https://bundlephobia.com/package/@shubham-01-star/chronotask-agent)
[![License](https://img.shields.io/npm/l/@shubham-01-star/chronotask-agent.svg?color=orange)](https://github.com/shubham-01-star/ChronoTask-AI)
[![Downloads](https://img.shields.io/npm/dm/@shubham-01-star/chronotask-agent.svg)](https://www.npmjs.com/package/@shubham-01-star/chronotask-agent)

A lightweight, zero-dependency Node.js and TypeScript client SDK for integrating scheduled cron jobs, background task runners, and queue consumers with the **ChronoTask AI Self-Healing SRE Platform**.

---

## 🚀 Key Features

*   **⚡ Zero Dependencies**: Extremely lightweight. Built using native Node.js core modules.
*   **🧬 Closed-Loop Self-Healing**: Connects to the ChronoTask AI real-time event stream. Automatically handles dynamic task suspensions and retry backoffs.
*   **🔑 Zero-Downtime Credential Rotation**: Synchronizes rotated SRE API access keys in-memory on the fly without interrupting telemetry uploads.
*   **📊 Automatic Telemetry Logging**: Instantly maps execution duration, status metrics, error reports, and stack traces.

---

## 🗺️ How it Works

```
                        ┌─────────────────────────────────┐
                        │   ChronoTask AI Dashboard UI     │
                        └────────────────┬────────────────┘
                                         │ Admin Toggles / Key Rotation
                                         ▼
   ┌──────────────────┐ Telemetry POST  ┌─────────────────────────────────┐
   │ My Cron / Worker ├────────────────►│ ChronoTask AI Backend Ingestor  │
   │   Task Runner    │                 └────────────────┬────────────────┘
   │                  │ SSE Control Stream               │ Async AI Diagnostics
   │  (Runs SDK Agent)◄──────────────────────────────────┘
   └──────────────────┘ (Task Toggle, AI Cooldown, Key Rotation)
```

---

## 📦 Installation

Install the package via your preferred package manager:

```bash
npm install @shubham-01-star/chronotask-agent
```

---

## ⚡ Quick Start

### 1. Basic Ingestion Setup
The most basic configuration allows logging execution durations, errors, and attempts:

```typescript
import { ChronoTaskAgent } from '@shubham-01-star/chronotask-agent';

// Initialize the SRE Agent
const agent = new ChronoTaskAgent({
  apiKey: 'ct_live_your_sre_access_token_here',
  endpoint: 'http://localhost:5000/api/v1',
  enableSelfHealing: false // Standard telemetry tracking only
});

async function myTask() {
  const start = Date.now();
  try {
    // ---> Execute your task workload here <---
    
    await agent.report({
      task_name: 'database_cleanup_job',
      cron_expression: '0 0 * * *',
      status: 'SUCCESS',
      duration_ms: Date.now() - start,
      attempt_number: 1
    });
  } catch (error: any) {
    await agent.report({
      task_name: 'database_cleanup_job',
      cron_expression: '0 0 * * *',
      status: 'FAILED',
      duration_ms: Date.now() - start,
      attempt_number: 1,
      error_summary: error.message,
      stack_trace: error.stack
    });
  }
}
```

---

### 2. Full Self-Healing Setup (Closed-Loop)
By enabling `enableSelfHealing`, the agent connects to the ChronoTask control plane over SSE, applying dynamic administrative and AI-generated blocks automatically.

```typescript
import { ChronoTaskAgent } from '@shubham-01-star/chronotask-agent';

const agent = new ChronoTaskAgent({
  apiKey: 'ct_live_your_sre_access_token_here',
  endpoint: 'http://localhost:5000/api/v1',
  enableSelfHealing: true // Opens real-time control connection
});

// Configure hooks to print SRE events
agent.onRemediation((remediation) => {
  console.log(`[AI Diagnostics] Recommended Backoff Action: ${remediation.action_taken}`);
  console.log(`[AI Diagnostics] Recommended Fix Code Patch:\n${remediation.suggested_fix}`);
});

agent.onTaskToggled((task) => {
  console.log(`[SRE Admin Action] Task "${task.task_name}" changed state to: ${task.status}`);
});

agent.onKeyRotated((newKey) => {
  console.log(`[Security Alert] Access key rotated! Syncing token in-memory to: ${newKey}`);
});

// Wrapping the schedule execution block:
async function runStripeInvoiceSync() {
  const taskName = 'stripe_invoice_sync';

  // 1. Safety check: Block execution if task is suspended or in AI cooldown backoff
  if (agent.isSuspended(taskName)) {
    const cooldownLeft = agent.getRemainingBackoffSeconds(taskName);
    console.warn(`[Execution Blocked] Task "${taskName}" is suspended. Cooldown: ${cooldownLeft}s`);
    return;
  }

  const start = Date.now();
  try {
    // ---> Execute Stripe Sync logic <---

    await agent.report({
      task_name: taskName,
      cron_expression: '*/10 * * * *',
      status: 'SUCCESS',
      duration_ms: Date.now() - start,
      attempt_number: 1
    });
  } catch (err: any) {
    await agent.report({
      task_name: taskName,
      cron_expression: '*/10 * * * *',
      status: 'FAILED',
      duration_ms: Date.now() - start,
      attempt_number: 1,
      error_summary: err.message,
      stack_trace: err.stack
    });
  }
}
```

---

## 📖 API Reference

### Configurations
```typescript
interface ChronoTaskAgentConfig {
  apiKey: string;              // Telemetry credentials from dashboard settings
  endpoint?: string;           // ChronoTask Ingestion endpoint. Defaults to 'http://localhost:5000/api/v1'
  enableSelfHealing?: boolean; // Toggles Server-Sent Event stream listeners. Defaults to true
}
```

### Methods

#### `report(payload: TelemetryPayload): Promise<{ success: boolean; execution_id?: string; error?: string }>`
Sends execution logs to the database. If the status is `'FAILED'`, triggers the asynchronous Gemini AI agent diagnostic pipeline.

#### `isSuspended(taskName: string): boolean`
Returns `true` if the task has been paused manually by an SRE administrator, or is temporarily throttle-blocked during an active dynamic backoff cooldown.

#### `getRemainingBackoffSeconds(taskName: string): number`
Returns the remaining cooldown time in seconds for backoff thorttling. Returns `0` if not throttled.

#### `disconnect(): void`
Gracefully unsubscribes from the control SSE streams and releases socket connections.

### SSE Event Hooks

#### `onRemediation(callback: (remediation: any) => void): void`
Subscribes to asynchronous AI diagnostic updates when Gemini finishes analysis.

#### `onTaskToggled(callback: (task: any) => void): void`
Subscribes to real-time administrative suspensions / activations.

#### `onKeyRotated(callback: (apiKey: string) => void): void`
Subscribes to zero-downtime key rotation operations.

---

## 📄 License

This SDK is open-source software licensed under the [MIT License](LICENSE).
