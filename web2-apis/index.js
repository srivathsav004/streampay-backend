// web2-apis/index.js
import express from 'express';
import { supabase } from './db.js';

const router = express.Router();

// Simple health check
router.get('/health', (req, res) => {
  return res.json({ ok: true, service: 'web2-apis' });
});

// Upsert a user profile by address (per schema: id, address, created_at)
router.post('/users/upsert', async (req, res) => {
  try {
    const { address } = req.body || {};

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address is required' });
    }

    const payload = { address: address.toLowerCase() };

    const { data, error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'address' })
      .select('id, address, created_at')
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, user: data?.[0] || payload });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

export default router;
