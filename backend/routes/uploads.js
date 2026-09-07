import express from 'express';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { getUploadUrl } from '../storage.js';

const router = express.Router();
router.use(requireAuth);

// Effectively "no limit" per your request, since these bytes never touch your PC -
// they go straight from the user's browser to Backblaze. This cap only guards
// against someone uploading one giant file that eats your free storage quota.
// Change this single number if you want it higher or lower.
const MAX_BYTES = 500 * 1024 * 1024; // 500MB

// Client asks for a presigned PUT URL, uploads directly to Backblaze with it,
// then tells the WebSocket server the resulting object key. Your Node server
// never sees the file bytes - just this small metadata exchange. The bucket
// stays Private (no card-requiring public-bucket fee) - downloads use their
// own short-lived signed URL, generated in channels.js and ws.js.
// Any file type is allowed (no MIME allowlist) - only the size cap above applies.
router.post('/presign', async (req, res) => {
  const { filename, contentType, size } = req.body;
  if (!filename || !contentType || !size) {
    return res.status(400).json({ error: 'Missing filename, contentType, or size' });
  }
  if (size > MAX_BYTES) {
    return res.status(400).json({ error: `File exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit` });
  }

  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const key = `${req.user.id}/${nanoid(16)}.${ext}`;

  const uploadUrl = await getUploadUrl(key, contentType || 'application/octet-stream');
  res.json({ uploadUrl, key });
});

export default router;
