import { EventEmitter } from 'events';

class DashboardEventEmitter extends EventEmitter {}

export const dashboardEvents = new DashboardEventEmitter();

// Event constants
export const EVENTS = {
  TELEMETRY_INGESTED: 'telemetry_ingested',
  REMEDIATION_CREATED: 'remediation_created',
};
