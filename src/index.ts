import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import telemetryRouter from './routes/telemetry';
import dashboardRouter from './routes/dashboard';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for all routes (important for B2B API cross-origin requests and Next.js frontend binding)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'x-api-key'],
}));

// Standard JSON body parsing
app.use(express.json());

// Application Routers
app.use('/api/v1/telemetry', telemetryRouter);
app.use('/api/v1/dashboard', dashboardRouter);

// Service Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ChronoTask AI Telemetry Engine',
    timestamp: new Date().toISOString()
  });
});

// Start Express Listener
app.listen(PORT, () => {
  console.log(`[ChronoTask AI] Ingestion Server is running on port ${PORT}`);
  console.log(`[ChronoTask AI] Node Environment: ${process.env.NODE_ENV || 'development'}`);
});
