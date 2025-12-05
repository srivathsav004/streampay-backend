import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { supabase } from './db.js';

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY_URL = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs';

function minutesBetween(a, b) {
  const diffMs = Math.max(0, b.getTime() - a.getTime());
  return Math.floor(diffMs / 60000);
}

// POST /storage/upload
// form-data: file, user_address
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!PINATA_JWT) return res.status(500).json({ error: 'Missing PINATA_JWT in env' });
    const file = req.file;
    const user_address = String(req.body?.user_address || '').toLowerCase();
    if (!file) return res.status(400).json({ error: 'file is required (multipart/form-data)' });
    if (!user_address) return res.status(400).json({ error: 'user_address is required' });

    // Pin to Pinata
    const fd = new FormData();
    fd.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });
    const pinRes = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', fd, {
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        ...fd.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const cid = pinRes?.data?.IpfsHash;
    if (!cid) return res.status(502).json({ error: 'Pinata did not return a CID' });

    // Idempotency: if same user already has this CID active, return it
    const { data: existingRows, error: existErr } = await supabase
      .from('storage_files')
      .select('*')
      .eq('user_address', user_address)
      .eq('file_cid', cid)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (existErr) return res.status(500).json({ error: existErr.message });
    if (existingRows && existingRows.length > 0) {
      const row = existingRows[0];
      return res.json({ success: true, file: row, gateway_url: `${PINATA_GATEWAY_URL}/${cid}`, idempotent: true });
    }

    // Insert DB row
    const displayName = (req.body && req.body.name ? String(req.body.name) : '') || file.originalname;
    const payload = {
      user_address,
      filename: displayName,
      size_bytes: file.size,
      content_type: file.mimetype || null,
      file_cid: cid,
    };
    const { data, error } = await supabase
      .from('storage_files')
      .insert(payload)
      .select('*')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });

    const row = data?.[0] || null;
    return res.json({ success: true, file: row, gateway_url: `${PINATA_GATEWAY_URL}/${cid}` });
  } catch (err) {
    return res.status(500).json({ error: err?.response?.data?.error || err?.message || 'Upload failed' });
  }
});

// POST /storage/files - list files for a user (active by default)
router.post('/files', async (req, res) => {
  try {
    const { user_address, include_deleted } = req.body || {};
    const addr = String(user_address || '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'user_address is required' });
    let q = supabase
      .from('storage_files')
      .select('*')
      .eq('user_address', addr)
      .order('created_at', { ascending: false });
    if (!include_deleted) q = q.is('deleted_at', null);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ files: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// POST /storage/download-url
router.post('/download-url', async (req, res) => {
  try {
    const { file_cid } = req.body || {};
    if (!file_cid) return res.status(400).json({ error: 'file_cid is required' });
    return res.json({ url: `${PINATA_GATEWAY_URL}/${file_cid}` });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// POST /storage/delete - soft delete + update billing
router.post('/delete', async (req, res) => {
  try {
    const { id, user_address, amount_usdc, tx_hash } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    const addr = String(user_address || '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'user_address is required' });

    // Fetch existing to compute storage_min
    const { data: rows, error: e1 } = await supabase
      .from('storage_files')
      .select('id, uploaded_at')
      .eq('id', id)
      .eq('user_address', addr)
      .limit(1);
    if (e1) return res.status(500).json({ error: e1.message });
    const existing = rows?.[0];
    if (!existing) return res.status(404).json({ error: 'File not found' });

    const uploadedAt = new Date(existing.uploaded_at);
    const now = new Date();
    const storage_min = minutesBetween(uploadedAt, now);

    const { data, error } = await supabase
      .from('storage_files')
      .update({ deleted_at: now.toISOString(), amount_usdc: amount_usdc != null ? Number(amount_usdc) : null, tx_hash: tx_hash || null, storage_min })
      .eq('id', id)
      .eq('user_address', addr)
      .select('*')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, file: data?.[0] || null });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// POST /storage/update - update tx or fields for UX
router.post('/update', async (req, res) => {
  try {
    const { id, user_address, ...fields } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    const addr = String(user_address || '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'user_address is required' });
    const { data, error } = await supabase
      .from('storage_files')
      .update(fields)
      .eq('id', id)
      .eq('user_address', addr)
      .select('*')
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, file: data?.[0] || null });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// POST /storage/stats - totals and aggregates
router.post('/stats', async (req, res) => {
  try {
    const { user_address } = req.body || {};
    const addr = String(user_address || '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'user_address is required' });
    const { data: files, error } = await supabase
      .from('storage_files')
      .select('*')
      .eq('user_address', addr);
    if (error) return res.status(500).json({ error: error.message });

    const now = new Date();
    let totalSpent = 0;
    let totalStoredBytes = 0;
    let activeFiles = 0;
    let storageTimeMin = 0;
    (files || []).forEach(f => {
      const isDeleted = !!f.deleted_at;
      if (!isDeleted) {
        activeFiles += 1;
        totalStoredBytes += Number(f.size_bytes || 0);
        const mins = minutesBetween(new Date(f.uploaded_at), now);
        storageTimeMin += mins;
      } else {
        totalSpent += Number(f.amount_usdc || 0);
      }
    });
    return res.json({
      totalSpentUSDC: totalSpent,
      totalStoredGB: totalStoredBytes / (1024 ** 3),
      activeFiles,
      storageTimeHours: Math.round(storageTimeMin / 60),
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

// POST /storage/usage - upload/delete history
router.post('/usage', async (req, res) => {
  try {
    const { user_address } = req.body || {};
    const addr = String(user_address || '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'user_address is required' });
    const { data: files, error } = await supabase
      .from('storage_files')
      .select('*')
      .eq('user_address', addr)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const items = (files || []).flatMap((f) => {
      const uploadItem = {
        id: `u-${f.id}`,
        action: 'upload',
        fileName: f.filename,
        date: new Date(f.uploaded_at).toISOString(),
        cost: 0,
        fileSize: Number(f.size_bytes || 0),
        ipfsCid: f.file_cid,
        txHash: null,
      };
      const arr = [uploadItem];
      if (f.deleted_at) {
        arr.push({
          id: `d-${f.id}`,
          action: 'delete',
          fileName: f.filename,
          date: new Date(f.deleted_at).toISOString(),
          duration: minutesBetween(new Date(f.uploaded_at), new Date(f.deleted_at)) / 60,
          cost: Number(f.amount_usdc || 0),
          fileSize: Number(f.size_bytes || 0),
          ipfsCid: f.file_cid,
          txHash: f.tx_hash || null,
        });
      }
      return arr;
    });
    return res.json({ history: items });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

export default router;

