import express from 'express';
import { supabase } from './db.js';

const router = express.Router();
 

router.post('/stats', async (req, res) => {
  try {
    const user_address = String((req.body?.user_address) || '').toLowerCase();
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

router.post('/history', async (req, res) => {
  try {
    const user_address = String((req.body?.user_address) || '').toLowerCase();
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

router.post('/cost', async (req, res) => {
  try {
    const user_address = String((req.body?.user_address) || '').toLowerCase();
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
