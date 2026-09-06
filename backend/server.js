import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import channelRoutes from './routes/channels.js';
import voiceRoutes from './routes/voice.js';
import uploadRoutes from './routes/uploads.js';
import { attachWebSocket } from './ws.js';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/uploads', uploadRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
attachWebSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
