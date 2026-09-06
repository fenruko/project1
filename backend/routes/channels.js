import express from 'express';
import { nanoid } from 'nanoid';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// Browse public channels
router.get('/public', async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, owner_id, created_at FROM channels WHERE is_private = false ORDER BY created_at DESC LIMIT 100'
  );
  res.json(result.rows);
});

// Channels the current user belongs to
router.get('/mine', async (req, res) => {
  const result = await pool.query(
    `SELECT c.id, c.name, c.is_private, c.invite_code, cm.role
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// Create a channel (public or private)
router.post('/', async (req, res) => {
  const { name, isPrivate } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Channel name must be at least 2 characters' });
  }
  const inviteCode = isPrivate ? nanoid(10) : null;

  const result = await pool.query(
    'INSERT INTO channels (name, owner_id, is_private, invite_code) VALUES ($1, $2, $3, $4) RETURNING *',
    [name.trim(), req.user.id, !!isPrivate, inviteCode]
  );
  const channel = result.rows[0];

  await pool.query(
    'INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, $3)',
    [channel.id, req.user.id, 'owner']
  );

  res.json(channel);
});

// Join a public channel by id
router.post('/:id/join', async (req, res) => {
  const channel = (await pool.query('SELECT * FROM channels WHERE id = $1', [req.params.id])).rows[0];
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (channel.is_private) return res.status(403).json({ error: 'This channel requires an invite code' });

  await pool.query(
    'INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [channel.id, req.user.id]
  );
  res.json({ ok: true, channel });
});

// Join a private channel via invite code
router.post('/join-by-code', async (req, res) => {
  const { code } = req.body;
  const channel = (await pool.query('SELECT * FROM channels WHERE invite_code = $1', [code])).rows[0];
  if (!channel) return res.status(404).json({ error: 'Invalid invite code' });

  await pool.query(
    'INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [channel.id, req.user.id]
  );
  res.json({ ok: true, channel });
});

// Recent message history (last 50)
router.get('/:id/messages', async (req, res) => {
  const isMember = (
    await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
  ).rows[0];
  if (!isMember) return res.status(403).json({ error: 'Not a member of this channel' });

  const result = await pool.query(
    `SELECT m.id, m.content, m.created_at, u.username
     FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = $1
     ORDER BY m.created_at DESC
     LIMIT 50`,
    [req.params.id]
  );
  res.json(result.rows.reverse());
});

export default router;
