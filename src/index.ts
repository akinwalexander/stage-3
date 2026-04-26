import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import profileRoutes from './routes/profile.routes';
import authRoutes from './routes/auth.routes';
import { handleError } from './utils/errors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
];

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('combined'));

// ─── API Versioning Header ────────────────────────────────────────────────────

app.use('/api', (req, res, next) => {
  res.setHeader('X-API-Version', '1.0.0');

  const requestedVersion = req.headers['accept-version'] || req.headers['x-api-version'];
  if (requestedVersion && requestedVersion !== '1.0.0' && requestedVersion !== '1') {
    return res.status(400).json({
      status: 'error',
      message: `API version ${requestedVersion} is not supported. Use version 1.0.0`,
    });
  }

  next();
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: (req) => req.path.includes('/callback'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many auth attempts, please try again later.' },
});

app.use('/api/', globalLimiter);
app.use('/api/auth', authLimiter);

// ─── Swagger Docs ─────────────────────────────────────────────────────────────

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/profiles', profileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes);

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'success',
    db: !!process.env.DATABASE_URL,
    timestamp: new Date().toISOString(),
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  handleError(err, res);
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Intelligence Engine running on http://localhost:${PORT}`);
  console.log(`Swagger docs at http://localhost:${PORT}/api/docs`);
  console.log(`Accepting requests from ${FRONTEND_URL}`);

  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL && process.env.NODE_ENV === 'production') {
    setInterval(async () => {
      try {
        await fetch(`${RENDER_URL}/api/health`);
        console.log('Keep-alive ping sent');
      } catch (err) {
        console.error('Keep-alive ping failed:', err);
      }
    }, 14 * 60 * 1000);
  }
});