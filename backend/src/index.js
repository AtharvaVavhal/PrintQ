require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');

const {
  helmetConfig,
  corsOptions,
  globalLimiter,
  compression,
  morgan,
} = require('./middleware/security');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const healthRouter = require('./routes/health');
const authRouter   = require('./routes/auth');
const jobsRouter     = require('./routes/jobs');
const paymentsRouter = require('./routes/payments');

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: [process.env.FRONTEND_URL, process.env.STUDENT_PORTAL_URL].filter(Boolean),
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

app.set('io', io);
app.use((req, _res, next) => {
  req.io = io;
  next();
});

app.use(helmetConfig);
app.use(corsOptions);
app.use(compression);
app.use(morgan);
app.use(globalLimiter);
app.use(cookieParser());

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);

app.use('/api/payments', paymentsRouter);
app.use('/api/printers', (req, res) => res.json({ message: 'Printer routes — Day 9' }));
app.use('/api/admin',    (req, res) => res.json({ message: 'Admin routes — Day 7' }));

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);
  socket.on('join:job', (jobId) => {
    socket.join(`job:${jobId}`);
  });
  socket.on('join:printer', (printerId) => {
    socket.join(`printer:${printerId}`);
  });
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════╗
║   PrintQ API — running on :${PORT}  ║
║   ENV: ${(process.env.NODE_ENV || 'development').padEnd(24)}║
╚══════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});

module.exports = { app, io };
