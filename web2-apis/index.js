// web2-apis/index.js
import express from 'express';
import { supabase } from './db.js';
import aiRouter from './ai.js';
import storageRouter from './storage.js';

const router = express.Router();

// Simple health check
router.get('/health', (req, res) => {
  return res.json({ ok: true, service: 'web2-apis' });
});

router.use('/ai', aiRouter);
router.use('/storage', storageRouter);

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

// List active videos from catalog_videos
router.get('/videos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('catalog_videos')
      .select('id, url, duration_seconds, active')
      .eq('active', true)
      .order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ videos: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// Helper to resolve catalog video id from url if not provided
async function resolveVideoIdFromUrl(url) {
  if (!url) return null;
  const { data, error } = await supabase
    .from('catalog_videos')
    .select('id')
    .eq('url', url)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}

// Insert a streaming session record
router.post('/video-stream-sessions', async (req, res) => {
  try {
    const { user_address, video_id, url, seconds_streamed, amount_usdc, tx_hash } = req.body || {};
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });
    let vid = video_id;
    if (!vid && url) vid = await resolveVideoIdFromUrl(url);
    if (!vid) return res.status(400).json({ error: 'video_id or url required' });
    const payload = {
      user_address: String(user_address).toLowerCase(),
      video_id: Number(vid),
      seconds_streamed: typeof seconds_streamed === 'number' ? seconds_streamed : null,
      amount_usdc: amount_usdc != null ? Number(amount_usdc) : null,
      tx_hash: tx_hash || null,
    };
    const { data, error } = await supabase
      .from('video_stream_sessions')
      .insert(payload)
      .select('id, user_address, video_id, seconds_streamed, amount_usdc, tx_hash, created_at')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, session: data?.[0] || null });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// Insert or upsert a video purchase
router.post('/video-purchases', async (req, res) => {
  try {
    const { user_address, video_id, url, amount_usdc, tx_hash } = req.body || {};
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });
    if (amount_usdc == null) return res.status(400).json({ error: 'amount_usdc is required' });
    if (!tx_hash) return res.status(400).json({ error: 'tx_hash is required' });
    let vid = video_id;
    if (!vid && url) vid = await resolveVideoIdFromUrl(url);
    if (!vid) return res.status(400).json({ error: 'video_id or url required' });
    const payload = {
      user_address: String(user_address).toLowerCase(),
      video_id: Number(vid),
      amount_usdc: Number(amount_usdc),
      tx_hash: String(tx_hash),
    };
    const { data, error } = await supabase
      .from('video_purchases')
      .upsert(payload, { onConflict: 'user_address,video_id' })
      .select('id, user_address, video_id, amount_usdc, tx_hash, purchased_at')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, purchase: data?.[0] || null });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// Get purchases for a user, with basic video info merged
router.get('/users/:address/purchases', async (req, res) => {
  try {
    const addr = String(req.params.address || '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'address is required' });
    const { data: purchases, error: err1 } = await supabase
      .from('video_purchases')
      .select('id, user_address, video_id, amount_usdc, tx_hash, purchased_at')
      .eq('user_address', addr)
      .order('purchased_at', { ascending: false });
    if (err1) return res.status(500).json({ error: err1.message });
    const ids = (purchases || []).map(p => p.video_id);
    let videosById = {};
    if (ids.length > 0) {
      const { data: vids, error: err2 } = await supabase
        .from('catalog_videos')
        .select('id, url, duration_seconds, active')
        .in('id', ids);
      if (err2) return res.status(500).json({ error: err2.message });
      videosById = Object.fromEntries((vids || []).map(v => [v.id, v]));
    }
    const result = (purchases || []).map(p => ({ ...p, video: videosById[p.video_id] || null }));
    return res.json({ purchases: result });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// Get stream sessions for a user, with basic video info merged
router.get('/users/:address/stream-sessions', async (req, res) => {
  try {
    const addr = String(req.params.address || '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'address is required' });
    const { data: sessions, error: err1 } = await supabase
      .from('video_stream_sessions')
      .select('id, user_address, video_id, seconds_streamed, amount_usdc, tx_hash, created_at')
      .eq('user_address', addr)
      .order('created_at', { ascending: false });
    if (err1) return res.status(500).json({ error: err1.message });
    const ids = (sessions || []).map(s => s.video_id);
    let videosById = {};
    if (ids.length > 0) {
      const { data: vids, error: err2 } = await supabase
        .from('catalog_videos')
        .select('id, url, duration_seconds, active')
        .in('id', ids);
      if (err2) return res.status(500).json({ error: err2.message });
      videosById = Object.fromEntries((vids || []).map(v => [v.id, v]));
    }
    const result = (sessions || []).map(s => ({ ...s, video: videosById[s.video_id] || null }));
    return res.json({ sessions: result });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

export default router;
