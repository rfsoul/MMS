// src/pm-scheduler.js
// node-cron job that runs the PM rolling window generator daily at midnight
'use strict';

const cron = require('node-cron');
const { runScheduler } = require('./services/pm-schedules.service');

let schedulerTask = null;

function startScheduler() {
  // Run daily at midnight
  schedulerTask = cron.schedule('0 0 * * *', async () => {
    console.log(`[PM Scheduler] Running at ${new Date().toISOString()}`);
    try {
      const summary = await runScheduler();
      console.log(
        `[PM Scheduler] Complete — ` +
        `${summary.schedules} schedules processed, ` +
        `${summary.total_generated} WOs generated, ` +
        `${summary.total_skipped} skipped`
      );
      // Log any per-schedule errors
      for (const r of summary.results) {
        if (r.errors && r.errors.length > 0) {
          console.error(`[PM Scheduler] Errors on schedule "${r.schedule_name}":`, r.errors);
        }
      }
    } catch (err) {
      console.error('[PM Scheduler] Fatal error during run:', err);
    }
  }, {
    timezone: process.env.TZ || 'Australia/Sydney',
  });

  console.log('[PM Scheduler] Started — runs daily at midnight');
}

function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('[PM Scheduler] Stopped');
  }
}

module.exports = { startScheduler, stopScheduler };
