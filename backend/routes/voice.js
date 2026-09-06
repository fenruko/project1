import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.post('/token', async (req, res) => {
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ error: 'Missing channelId' });

  const isMember = (
    await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, req.user.id]
    )
  ).rows[0];
  if (!isMember) return res.status(403).json({ error: 'Not a member of this channel' });

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: req.user.id,
    name: req.user.username,
  });
  at.addGrant({
    room: `channel-${channelId}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  res.json({ token, url: process.env.LIVEKIT_URL });
});

export default router;
