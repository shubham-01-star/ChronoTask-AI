-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. tenants
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    api_key_hash VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for authentication key lookup
CREATE INDEX IF NOT EXISTS idx_tenants_api_key_hash ON tenants(api_key_hash);

-- 2. cron_tasks
CREATE TABLE IF NOT EXISTS cron_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    task_name VARCHAR(255) NOT NULL,
    cron_expression VARCHAR(100) NOT NULL,
    max_retries INTEGER NOT NULL DEFAULT 3,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_task_name UNIQUE (tenant_id, task_name)
);

-- Index for tenant tasks lookup
CREATE INDEX IF NOT EXISTS idx_cron_tasks_tenant_id ON cron_tasks(tenant_id);

-- 3. task_executions
CREATE TABLE IF NOT EXISTS task_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES cron_tasks(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL, -- 'SUCCESS', 'FAILED', 'RETRYING'
    duration_ms INTEGER NOT NULL,
    error_summary TEXT,
    stack_trace TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance telemetry queries
CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON task_executions(task_id);
-- Compound index for fetching failure trends (e.g. past 24 hours of executions for a task)
CREATE INDEX IF NOT EXISTS idx_task_executions_task_triggered ON task_executions(task_id, triggered_at DESC);
-- Index for dashboard and metrics time-window queries
CREATE INDEX IF NOT EXISTS idx_task_executions_triggered_at ON task_executions(triggered_at DESC);

-- 4. ai_remediations
CREATE TABLE IF NOT EXISTS ai_remediations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES task_executions(id) ON DELETE CASCADE,
    root_cause_analysis TEXT NOT NULL,
    suggested_fix TEXT NOT NULL,
    action_taken VARCHAR(100) NOT NULL, -- 'DYNAMIC_BACKOFF', 'CIRCUIT_BREAKER', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for root-cause lookup via execution ID
CREATE INDEX IF NOT EXISTS idx_ai_remediations_execution_id ON ai_remediations(execution_id);
