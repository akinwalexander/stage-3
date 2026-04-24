import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import profileRoutes from './routes/profile.routes';
import { handleError } from './utils/errors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve Frontend Path
const publicPath = path.join(__dirname, 'public');

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. Static Files (Dashboard)
app.use(express.static(publicPath));

// 2. API Routes
app.use('/api/profiles', profileRoutes);

// 3. Health API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'success', 
    db: !!process.env.DATABASE_URL,
    ui: fs.existsSync(path.join(publicPath, 'index.html'))
  });
});

// 4. UI Catch-all handler
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.json({ status: 'success', message: 'API is live. Dashboard loading failed.' });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  handleError(err, res);
});

app.listen(PORT, () => {
  console.log(`Intelligence Engine starting on port ${PORT}`);
});
