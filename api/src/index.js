// src/index.js
require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes        = require('./routes/auth.routes');
const companiesRoutes   = require('./routes/companies.routes');
const usersRoutes       = require('./routes/users.routes');
const assetsRoutes      = require('./routes/assets.routes');
const assetTypesRoutes  = require('./routes/asset-types.routes');
const workOrdersRoutes  = require('./routes/work-orders.routes');
const checklistsRoutes  = require('./routes/checklists.routes');
const tasksRoutes       = require('./routes/work-order-tasks.routes');
const pmRoutes          = require('./routes/pm-schedules.routes');
const issuesRoutes      = require('./routes/issues.routes');
const reportersRoutes   = require('./routes/reporters.routes');
const rfControlRoutes   = require('./routes/rf-control.routes');
const { startScheduler } = require('./pm-scheduler');
const { errorHandler, notFound } = require('./middleware/error.middleware');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// Security middleware
// ─────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin:         process.env.CORS_ORIGIN || '*',
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(rateLimit({
  windowMs:        15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    code:    'RATE_LIMITED',
    message: 'Too many requests, please try again later',
  },
}));

// ─────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────
// Health check
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────
// Routes
// ─────────────────────────────────────────
app.use('/auth',                           authRoutes);
app.use('/companies',                      companiesRoutes);
app.use('/users',                          usersRoutes);
app.use('/assets',                         assetsRoutes);
app.use('/asset-types',                    assetTypesRoutes);
app.use('/work-orders',                    workOrdersRoutes);
app.use('/work-orders/:workOrderId/tasks', tasksRoutes);
app.use('/checklists',                     checklistsRoutes);
app.use('/pm',                             pmRoutes);
app.use('/issues',                         issuesRoutes);
app.use('/reporters',                      reportersRoutes);
app.use('/rf-control',                     rfControlRoutes);

// ─────────────────────────────────────────
// Error handling (must be last)
// ─────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─────────────────────────────────────────
// Start server + scheduler
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`MMS API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start PM cron scheduler (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
  }
});

module.exports = app;
