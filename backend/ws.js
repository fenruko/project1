import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { getDownloadUrl, getAvatarUrl } from './storage.js';

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const rooms = new Map(); // channelId -> Set<ws>

  function broadcast(channelId, payload) {
    const data = JSON.stringify(payload);
    for (const client of rooms.get(channelId) || []) {
      if (client.readyState === 1) client.send(data);
    }
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }

    ws.user = user;
    ws.channelId = null;

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'join') {
        const isMember = (
          await pool.query(
            'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
            [msg.channelId, user.id]
          )
        ).rows[0];
        if (!isMember) {
          ws.send(JSON.stringify({ type: 'error', error: 'Not a member of this channel' }));
          return;
        }
        ws.channelId = msg.channelId;
        if (!rooms.has(msg.channelId)) rooms.set(msg.channelId, new Set());
        rooms.get(msg.channelId).add(ws);
        ws.send(JSON.stringify({ type: 'joined', channelId: msg.channelId }));
        return;
      }

      if (msg.type === 'message' && ws.channelId) {
        const content = String(msg.content || '').slice(0, 4000).trim();
        const attachmentKey = msg.attachmentKey ? String(msg.attachmentKey).slice(0, 500) : null;
        const attachmentType = ['image', 'audio', 'video', 'file'].includes(msg.attachmentType) ? msg.attachmentType : null;
        const attachmentName = msg.attachmentName ? String(msg.attachmentName).slice(0, 255) : null;
        const attachmentSize = Number.isFinite(msg.attachmentSize) ? msg.attachmentSize : null;
        if (!content && !attachmentKey) return;

        const result = await pool.query(
          `INSERT INTO messages (channel_id, user_id, content, attachment_url, attachment_type, attachment_name, attachment_size)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
          [ws.channelId, user.id, content, attachmentKey, attachmentType, attachmentName, attachmentSize]
        );

        const avatarRow = (await pool.query('SELECT avatar_type, avatar_value FROM users WHERE id = $1', [user.id])).rows[0];

        broadcast(ws.channelId, {
          type: 'message',
          id: result.rows[0].id,
          channelId: ws.channelId,
          userId: user.id,
          username: user.username,
          avatar_url: await getAvatarUrl(avatarRow?.avatar_type, avatarRow?.avatar_value),
          content,
          attachment_url: attachmentKey ? await getDownloadUrl(attachmentKey) : null,
          attachment_type: attachmentType,
          attachment_name: attachmentName,
          attachment_size: attachmentSize,
          created_at: result.rows[0].created_at,
        });
      }

      if (msg.type === 'edit' && ws.channelId) {
        const content = String(msg.content || '').slice(0, 4000).trim();
        if (!content || !msg.id) return;

        const result = await pool.query(
          `UPDATE messages SET content = $1, edited_at = now()
           WHERE id = $2 AND channel_id = $3 AND user_id = $4 AND deleted = false
           RETURNING edited_at`,
          [content, msg.id, ws.channelId, user.id]
        );
        if (result.rows.length === 0) return; // not the owner, or message doesn't exist

        broadcast(ws.channelId, {
          type: 'edit',
          id: msg.id,
          channelId: ws.channelId,
          content,
          edited_at: result.rows[0].edited_at,
        });
      }

      if (msg.type === 'delete' && ws.channelId) {
        if (!msg.id) return;
        const result = await pool.query(
          `UPDATE messages SET deleted = true
           WHERE id = $1 AND channel_id = $2 AND user_id = $3
           RETURNING id`,
          [msg.id, ws.channelId, user.id]
        );
        if (result.rows.length === 0) return;

        broadcast(ws.channelId, { type: 'delete', id: msg.id, channelId: ws.channelId });
      }
    });

    ws.on('close', () => {
      if (ws.channelId && rooms.has(ws.channelId)) {
        rooms.get(ws.channelId).delete(ws);
      }
    });
  });
}
