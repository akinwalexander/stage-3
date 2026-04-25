import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import profileRoutes from './routes/profile.routes';
import authRoutes from './routes/auth.routes';
import { handleError } from './utils/errors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import cookieParser from 'cookie-parser';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Swagger Docs
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API Routes
app.use('/api/profiles', profileRoutes);
app.use('/api/auth', authRoutes);

// Health API
app.get('/api/health', (req, res) => {
  res.json({ status: 'success', db: !!process.env.DATABASE_URL });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  handleError(err, res);
});

app.listen(PORT, () => {
  console.log(`Intelligence Engine running on http://localhost:${PORT}`);
  console.log(`Swagger docs at http://localhost:${PORT}/api/docs`);
  console.log(`Accepting requests from ${FRONTEND_URL}`);
});