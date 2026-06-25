// routes/push.js — enregistrement des tokens FCM des appareils (app BIPBIP-mobile).
const express = require('express');
const router = express.Router();
const push = require('../services/push');

router.post('/register', (req, res) => {
  const { token, userId, platform } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token requis' });
  push.registerToken(token, userId, platform);
  res.json({ ok: true });
});

module.exports = router;
