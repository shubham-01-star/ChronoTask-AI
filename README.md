# ChronoTask AI — Autonomous Self-Healing SRE Platform

ChronoTask AI is an enterprise-grade B2B SRE observability and automated healing platform for background cron tasks, scheduled jobs, and queue consumers. It features real-time telemetry ingestion, interactive administrative controls, and an agentic AI diagnostic engine powered by Gemini 2.5 Flash that automatically analyzes failures and recommends code/remediation patches.

---

## 🏗️ Repository Architecture

The project consists of three main components:

1.  **Core Backend Service (Root)**:
    *   **Tech Stack**: Node.js, Express, TypeScript, PostgreSQL.
    *   **Role**: Handles high-throughput telemetry ingestion, manages access credentials, triggers asynchronous AI diagnostic workflows, and broadcasts real-time updates over a Server-Sent Events (SSE) stream.
2.  **Next.js Developer Dashboard (`/dashboard`)**:
    *   **Tech Stack**: Next.js (App Router), Tailwind CSS, Shadcn UI, Lucide Icons.
    *   **Role**: A modern dark-themed administration console displaying system metrics, PostgreSQL catalog health, task queues status, active AI incident logs, and credential configuration.
3.  **B2B Client Simulator (`/test-client`)**:
    *   **Tech Stack**: Node.js, TypeScript.
    *   **Role**: Simulates a live client task runner connecting to the SSE stream, reporting heartbeats, receiving automated diagnostics, and executing dynamic self-healing backoffs or instant token synchronization in-memory.

---

## ⚡ Quick Start (Local Setup)

Follow these steps to run the entire ChronoTask AI suite on your local machine.

### Prerequisites
*   [Docker & Docker Compose](https://www.docker.com/)
*   [Node.js](https://nodejs.org/) (v18 or higher)
*   [Gemini API Key](https://ai.google.dev/) (Optional; fallback mocks are provided if missing)

---

### Step 1: Set Up Environment Variables
Create a `.env` file in the root directory. You can copy the example configuration:
```bash
cp .env.example .env
```
Ensure you add your `GEMINI_API_KEY` to the file:
```ini
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres_dev_password
DB_NAME=chronotask_db
API_KEY_SALT=super_secret_salt_here
GEMINI_API_KEY=YOUR_ACTUAL_GEMINI_API_KEY
```

---

### Step 2: Spin Up the Database & Backend
Start the PostgreSQL database and backend app container using Docker Compose:
```bash
docker-compose up -d --build
```
This launches:
*   **Postgres Database** on port `5432` (automatically executing `schema.sql` on first start).
*   **Express Ingestion API** on port `5000`.

---

### Step 3: Database & Tenant Initialization

ChronoTask AI supports both **Clean Production Setup** and **Local Demo Seeding**. Choose one of the following depending on your needs:

#### Option A: Production/Clean Setup (Recommended for Real Projects)
1. **Initialize Database Schema**:
   Create all tables, triggers, and indexes without adding sample test data:
   ```bash
   DB_HOST=localhost npm run db:init
   ```
2. **Provision Your First Tenant & API Key**:
   Generate a secure, random client token for your company/organization directly from the CLI:
   ```bash
   DB_HOST=localhost npm run tenant:create -- --name="Your Company Name"
   ```
   *Take note of the printed SRE Access Token (`ct_live_...`) to connect your runners.*

#### Option B: Local Demo Setup (Quickstart)
If you just want to run local simulations and test immediately, populate the database with mock B2B tenants (e.g., "Acme Corp") and pre-configured test keys:
```bash
DB_HOST=localhost npm run db:seed
```
*Use the pre-seeded key `ct_live_acmedemo12345` for instant local testing.*

---

### Step 4: Run the Next.js Dashboard
Navigate to the dashboard directory, install dependencies, and start the Next.js development server:
```bash
cd dashboard
npm install
npm run dev -- --port 3000
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser to view the console.

---

### Step 5: Start the Client Simulator
To see self-healing, real-time alert broadcasts, and API key rotations in action, start the client simulator:
```bash
cd ../test-client
npm install
npm run dev
```

---

## 🛠️ Developer Integration Guide

Developers can integrate ChronoTask AI into their own systems using the following instructions.

### 1. Telemetry Ingest API
Send a `POST` request to `/api/v1/telemetry` when your cron jobs/workers finish executing.

*   **Headers**:
    ```http
    Content-Type: application/json
    x-api-key: <YOUR_SRE_ACCESS_TOKEN>
    ```
*   **Payload**:
    ```json
    {
      "task_name": "stripe_invoice_sync",
      "cron_expression": "*/5 * * * *",
      "status": "FAILED",
      "duration_ms": 3200,
      "attempt_number": 1,
      "error_summary": "StripeConnectionError: connection timed out after 3000ms",
      "stack_trace": "Error: StripeConnectionError: connection timed out...\n    at runJob (stripe.js:12:15)"
    }
    ```

### 2. Client-Side Self-Healing Integration
By connecting to the Server-Sent Events (SSE) stream (`/api/v1/dashboard/stream`), client runners can dynamically adjust behavior based on commands from the B2B dashboard or Gemini AI:

*   **`TASK_TOGGLED` event**: Admin manually suspends a task on the dashboard. The client runner blocks subsequent schedules immediately.
*   **`REMEDIATION_CREATED` event**: Gemini recommends a `DYNAMIC_BACKOFF` after a failure. The client blocks scheduled execution until the cooldown timer expires.
*   **`KEY_ROTATED` event**: The admin rotates access keys. The client instantly synchronizes the API key reference in-memory without restarting.

#### Code Snippet (Node.js Integration)
```typescript
import fetch from 'node-fetch';

const CHRONOTASK_URL = 'http://localhost:5000/api/v1/telemetry';
const SRE_TOKEN = 'YOUR_SRE_ACCESS_TOKEN';

async function logTelemetry(taskName: string, status: 'SUCCESS' | 'FAILED', durationMs: number, errorMsg?: string) {
  try {
    await fetch(CHRONOTASK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SRE_TOKEN
      },
      body: JSON.stringify({
        task_name: taskName,
        cron_expression: '*/10 * * * *',
        status: status,
        duration_ms: durationMs,
        attempt_number: 1,
        error_summary: errorMsg
      })
    });
  } catch (err) {
    console.error('ChronoTask unavailable:', err);
  }
}
```

---

## 🛡️ Production Deployment

To run ChronoTask AI in a cloud production environment (e.g. AWS):
1.  **Stateless API (Fargate)**: Deploy the backend Docker container onto AWS ECS Fargate behind an Application Load Balancer (ALB).
2.  **Stateful Storage (Aurora)**: Use AWS Aurora Serverless v2 PostgreSQL (Multi-AZ) for the database.
3.  **Secrets**: Inject configurations like `GEMINI_API_KEY` and database passwords using AWS Secrets Manager rather than static environment files.
4.  **Security Rules**: Restrict database ingress to ECS tasks only.
5.  *See [production_deployment_guide.md](file:///home/shubhambackenddev/.gemini/antigravity/brain/4f3e8e7e-f3c9-4b34-b592-2dcecd9a28e9/production_deployment_guide.md) for more details.*
