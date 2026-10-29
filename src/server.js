import 'dotenv/config';
import express from 'express';
import cors from 'cors';

console.log('🚀 Starting Dev Analyzer API...');
console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length);
console.log('DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'));

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET missing or shorter than 32 characters. Set it in .env');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing. Set it in .env');
  process.exit(1);
}

console.log('✅ Environment variables OK');
console.log('📦 Loading modules...');

const { initDb } = await import('./db.js');
const { requireAuth } = await import('./middleware/auth.js');
const { default: authRoutes } = await import('./routes/auth.js');
const { default: publicRoutes } = await import('./routes/public.js');
const { default: userRoutes } = await import('./routes/user.js');
const { default: goalRoutes } = await import('./routes/goals.js');
const { default: groupRoutes } = await import('./routes/groups.js');

console.log('✅ Modules loaded');

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'https://dev-analyzer-frontend.vercel.app',
  ...(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
];

app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], credentials: true }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);

app.use('/api', requireAuth);
app.use('/api/user', userRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/groups', groupRoutes);

app.use((req, res) => res.sendStatus(404));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

console.log('⏳ Initializing database...');
await initDb();
console.log('✅ Database initialized');

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`✅ Dev Analyzer API running on http://localhost:${port}`));
