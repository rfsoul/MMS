const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { setChannel, setPower, setAntenna, stopRf } = require('../services/rf-control.service');

const router = express.Router();

router.post('/channel', requireAuth, (req, res, next) => {
  try {
    const payload = setChannel(req.body?.channel);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

router.post('/power', requireAuth, (req, res, next) => {
  try {
    const payload = setPower(req.body?.power);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});



router.post('/stop', requireAuth, (req, res, next) => {
  try {
    const payload = stopRf();
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

router.post('/off', requireAuth, (req, res, next) => {
  try {
    const payload = stopRf();
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

router.post('/antenna', requireAuth, (req, res, next) => {
  try {
    const payload = setAntenna(req.body?.antenna);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
