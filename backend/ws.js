import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { getDownloadUrl } from './storage.js';

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const rooms = new Map(); // channelId -> Set<ws>

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

        const payload = JSON.stringify({
          type: 'message',
          id: result.rows[0].id,
          channelId: ws.channelId,
          username: user.username,
          content,
          attachment_url: attachmentKey ? await getDownloadUrl(attachmentKey) : null,
          attachment_type: attachmentType,
          attachment_name: attachmentName,
          attachment_size: attachmentSize,
          created_at: result.rows[0].created_at,
        });

        for (const client of rooms.get(ws.channelId) || []) {
          if (client.readyState === 1) client.send(payload);
        }
      }
    });

    ws.on('close', () => {
      if (ws.channelId && rooms.has(ws.channelId)) {
        rooms.get(ws.channelId).delete(ws);
      }
    });
  });
}
