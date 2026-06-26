import * as http from 'http';

export interface TelemetryPayload {
  task_name: string;
  cron_expression: string;
  status: 'SUCCESS' | 'FAILED' | 'RETRYING';
  duration_ms: number;
  attempt_number: number;
  error_summary?: string;
  stack_trace?: string;
}

export interface ChronoTaskAgentConfig {
  apiKey: string;
  endpoint?: string; // Defaults to http://localhost:5000/api/v1
  enableSelfHealing?: boolean; // Defaults to true
}

export class ChronoTaskAgent {
  private apiKey: string;
  private endpoint: string;
  private enableSelfHealing: boolean;
  
  // State management for self-healing
  private taskBackoffs = new Map<string, number>(); // task_name -> timestamp until which it is suspended
  private manuallySuspendedTasks = new Set<string>();
  
  // SSE connection references
  private sseRequest: http.ClientRequest | null = null;
  private isConnected = false;

  // Custom Event Listeners callbacks
  private remediationCallbacks: ((data: any) => void)[] = [];
  private toggleCallbacks: ((data: any) => void)[] = [];
  private keyRotatedCallbacks: ((apiKey: string) => void)[] = [];

  constructor(config: ChronoTaskAgentConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint || 'http://localhost:5000/api/v1';
    this.enableSelfHealing = config.enableSelfHealing !== false;

    if (this.enableSelfHealing) {
      this.connectToRemediationStream();
      this.fetchInitialSuspendedTasks();
    }
  }

  /**
   * Submits execution telemetry to ChronoTask AI.
   */
  async report(payload: TelemetryPayload): Promise<{ success: boolean; execution_id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.endpoint}/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as any;
      if (!response.ok) {
        return { success: false, error: data.error || 'Ingest failed' };
      }
      return { success: true, execution_id: data.execution_id };
    } catch (error: any) {
      return { success: false, error: error.message || 'Network transport error' };
    }
  }

  /**
   * Registers a callback for AI diagnostic remediations.
   */
  onRemediation(callback: (data: any) => void) {
    this.remediationCallbacks.push(callback);
  }

  /**
   * Registers a callback for admin task toggle events.
   */
  onTaskToggled(callback: (data: any) => void) {
    this.toggleCallbacks.push(callback);
  }

  /**
   * Registers a callback for API key rotations.
   */
  onKeyRotated(callback: (apiKey: string) => void) {
    this.keyRotatedCallbacks.push(callback);
  }

  /**
   * Checks if a task is currently blocked due to active admin suspension or dynamic backoff.
   */
  isSuspended(taskName: string): boolean {
    if (this.manuallySuspendedTasks.has(taskName)) {
      return true;
    }

    const suspendUntil = this.taskBackoffs.get(taskName);
    if (suspendUntil) {
      if (Date.now() < suspendUntil) {
        return true;
      }
      // Cooldown expired, cleanup state
      this.taskBackoffs.delete(taskName);
    }

    return false;
  }

  /**
   * Returns remaining backoff cooldown duration in seconds.
   */
  getRemainingBackoffSeconds(taskName: string): number {
    const suspendUntil = this.taskBackoffs.get(taskName);
    if (!suspendUntil) return 0;
    const diff = suspendUntil - Date.now();
    return diff > 0 ? Math.round(diff / 1000) : 0;
  }

  /**
   * Fetches initial suspended task queues from the console database.
   */
  private async fetchInitialSuspendedTasks() {
    try {
      const res = await fetch(`${this.endpoint}/dashboard/tasks`);
      if (res.ok) {
        const tasks = await res.json() as any[];
        for (const t of tasks) {
          if (t.status === 'SUSPENDED') {
            this.manuallySuspendedTasks.add(t.task_name);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[ChronoTask Agent] Initial suspended task state sync failed:`, err.message);
    }
  }

  /**
   * Core SSE logic linking real-time control path updates to runner.
   */
  private connectToRemediationStream() {
    const streamUrl = `${this.endpoint.replace('/api/v1', '')}/api/v1/dashboard/stream`;

    this.sseRequest = http.get(streamUrl, (res) => {
      this.isConnected = true;
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
              this.handleIncomingEvent(event);
            } catch (e) {
              // Ignore ping keep-alives or invalid structures
            }
          }
        }
      });
    });

    this.sseRequest.on('error', (err) => {
      this.isConnected = false;
      console.warn(`[ChronoTask Agent] SSE connection interrupted: ${err.message}. Reconnecting in 5s...`);
      setTimeout(() => this.connectToRemediationStream(), 5000);
    });
  }

  /**
   * Handles incoming SSE SRE notifications and triggers custom callbacks.
   */
  private handleIncomingEvent(event: any) {
    if (event.type === 'REMEDIATION_CREATED') {
      const data = event.data;
      if (data.action_taken === 'DYNAMIC_BACKOFF') {
        const delaySec = data.retry_delay_seconds || 30;
        this.taskBackoffs.set(data.task_name, Date.now() + delaySec * 1000);
      }
      this.remediationCallbacks.forEach(cb => cb(data));
    } else if (event.type === 'TASK_TOGGLED') {
      const task = event.data;
      if (task.status === 'SUSPENDED') {
        this.manuallySuspendedTasks.add(task.task_name);
      } else {
        this.manuallySuspendedTasks.delete(task.task_name);
      }
      this.toggleCallbacks.forEach(cb => cb(task));
    } else if (event.type === 'KEY_ROTATED') {
      const credentials = event.data;
      this.apiKey = credentials.api_key;
      this.keyRotatedCallbacks.forEach(cb => cb(credentials.api_key));
    }
  }

  /**
   * Destroys active stream listeners for clean application shutdown.
   */
  disconnect() {
    if (this.sseRequest) {
      this.sseRequest.destroy();
      this.sseRequest = null;
    }
    this.isConnected = false;
  }
}
