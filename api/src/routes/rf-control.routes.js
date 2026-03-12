const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { setChannel } = require('../services/rf-control.service');

const router = express.Router();

router.post('/channel', requireAuth, (req, res, next) => {
  try {
    const payload = setChannel(req.body?.channel);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
