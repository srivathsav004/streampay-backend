import express from 'express';
import { supabase } from './db.js';

const router = express.Router();

const PER_CALL_USDC = 0.001;

router.post('/session/start', async (req, res) => {
  try {
    const { user_address } = req.body || {};
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });
    const payload = {
      user_address: String(user_address).toLowerCase(),
      calls_count: 0,
      amount_usdc: 0,
      tx_hash: null,
    };
    const { data, error } = await supabase
      .from('api_sessions')
      .insert(payload)
      .select('id, user_address, calls_count, amount_usdc, tx_hash, created_at')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, session: data?.[0] || null });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { session_id, user_address, message } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });

    const { data: existing, error: fetchErr } = await supabase
      .from('api_sessions')
      .select('id, calls_count, amount_usdc')
      .eq('id', session_id)
      .eq('user_address', String(user_address).toLowerCase())
      .maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: 'session not found' });

    const nextCalls = (existing.calls_count || 0) + 1;
    const nextAmount = Number(existing.amount_usdc || 0) + PER_CALL_USDC;

    const { data: updated, error: upErr } = await supabase
      .from('api_sessions')
      .update({ calls_count: nextCalls, amount_usdc: nextAmount })
      .eq('id', session_id)
      .select('id, user_address, calls_count, amount_usdc, tx_hash, created_at')
      .limit(1);
    if (upErr) return res.status(500).json({ error: upErr.message });

    const assistant = `This is a sample response for: "${String(message || '').slice(0, 200)}"`;
    return res.json({
      success: true,
      reply: assistant,
      cost: PER_CALL_USDC,
      session: updated?.[0] || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.post('/session/settle', async (req, res) => {
  try {
    const { session_id, user_address, tx_hash } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });
    if (!tx_hash) return res.status(400).json({ error: 'tx_hash is required' });

    const { data, error } = await supabase
      .from('api_sessions')
      .update({ tx_hash })
      .eq('id', session_id)
      .eq('user_address', String(user_address).toLowerCase())
      .select('id, user_address, calls_count, amount_usdc, tx_hash, created_at')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, session: data?.[0] || null });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const user_address = String(req.query.user_address || '').toLowerCase();
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });

    const { data: all, error } = await supabase
      .from('api_sessions')
      .select('calls_count, amount_usdc, created_at')
      .eq('user_address', user_address);
    if (error) return res.status(500).json({ error: error.message });

    const totalCalls = (all || []).reduce((a, r) => a + (r.calls_count || 0), 0);
    const totalSpent = (all || []).reduce((a, r) => a + Number(r.amount_usdc || 0), 0);

    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const thisMonth = (all || []).filter(r => {
      const d = new Date(r.created_at);
      return d.getMonth() === month && d.getFullYear() === year;
    }).reduce((a, r) => a + (r.calls_count || 0), 0);

    const avgPerCall = totalCalls > 0 ? totalSpent / totalCalls : 0;

    return res.json({ totalCalls, totalSpent, avgPerCall, thisMonth });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const user_address = String(req.query.user_address || '').toLowerCase();
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });

    const { data, error } = await supabase
      .from('api_sessions')
      .select('id, calls_count, amount_usdc, tx_hash, created_at')
      .eq('user_address', user_address)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });

    const items = (data || []).map((r, idx) => ({
      id: String(r.id),
      sessionNumber: r.id,
      date: new Date(r.created_at).toLocaleString(),
      calls: r.calls_count || 0,
      cost: Number(r.amount_usdc || 0),
      txHash: r.tx_hash || null,
    }));

    return res.json({ history: items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.get('/cost', async (req, res) => {
  try {
    const user_address = String(req.query.user_address || '').toLowerCase();
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });

    const { data, error } = await supabase
      .from('api_sessions')
      .select('amount_usdc, calls_count, created_at')
      .eq('user_address', user_address);
    if (error) return res.status(500).json({ error: error.message });

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0,0,0,0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const inRange = (from) => (data || []).filter(r => new Date(r.created_at) >= from);

    const week = inRange(startOfWeek);
    const month = inRange(startOfMonth);

    const sum = (arr, key) => arr.reduce((a, r) => a + Number(r[key] || 0), 0);
    const sumCalls = (arr) => arr.reduce((a, r) => a + (r.calls_count || 0), 0);

    const thisWeek = {
      cost: sum(week, 'amount_usdc'),
      calls: sumCalls(week),
      sessions: week.length,
    };

    const thisMonth = {
      cost: sum(month, 'amount_usdc'),
      calls: sumCalls(month),
      sessions: month.length,
    };

    const avgCostPerSession = (data?.length || 0) > 0 ? sum(data || [], 'amount_usdc') / (data?.length || 1) : 0;

    const daysSet = new Set((data || []).map(r => new Date(r.created_at).toDateString()));
    const avgCallsPerDay = daysSet.size > 0 ? sumCalls(data || []) / daysSet.size : 0;

    return res.json({ thisWeek, thisMonth, avgCostPerSession, avgCallsPerDay });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

export default router;

// New: record finalized usage entry after tx is processed (preferred flow)
// Body: { user_address, calls_count, amount_usdc, tx_hash, details? }
router.post('/record', async (req, res) => {
  try {
    const { user_address, calls_count, amount_usdc, tx_hash, details } = req.body || {};
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });
    if (calls_count == null) return res.status(400).json({ error: 'calls_count is required' });
    if (amount_usdc == null) return res.status(400).json({ error: 'amount_usdc is required' });
    if (!tx_hash) return res.status(400).json({ error: 'tx_hash is required' });

    const payload = {
      user_address: String(user_address).toLowerCase(),
      calls_count: Number(calls_count),
      amount_usdc: Number(amount_usdc),
      tx_hash: String(tx_hash),
    };

    const { data, error } = await supabase
      .from('api_sessions')
      .insert(payload)
      .select('id, user_address, calls_count, amount_usdc, tx_hash, created_at')
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, record: data?.[0] || null });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});
