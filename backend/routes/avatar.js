import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getAvatarUrl } from '../storage.js';

const router = express.Router();
router.use(requireAuth);

// Set your profile picture - either a key from /api/uploads/presign (avatarType: 'upload')
// or a direct GIF URL from GIPHY (avatarType: 'external').
router.patch('/', async (req, res) => {
  const { avatarType, avatarValue } = req.body;
  if (!['upload', 'external'].includes(avatarType) || !avatarValue) {
    return res.status(400).json({ error: 'Invalid avatar data' });
  }
  if (avatarType === 'external' && !/^https:\/\//.test(avatarValue)) {
    return res.status(400).json({ error: 'External avatar must be an https URL' });
  }

  await pool.query('UPDATE users SET avatar_type = $1, avatar_value = $2 WHERE id = $3', [
    avatarType, avatarValue, req.user.id,
  ]);

  const avatarUrl = await getAvatarUrl(avatarType, avatarValue);
  res.json({ avatarUrl });
});

export default router;
