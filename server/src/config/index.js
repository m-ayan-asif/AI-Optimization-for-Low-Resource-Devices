require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Refuse to boot a production server with a missing or placeholder JWT secret: anyone could forge tokens.
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /change/i.test(process.env.JWT_SECRET))) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production');
}

module.exports = {
  port: process.env.PORT || 5000,
  isProduction,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'skinsense',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '30m',
  },
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  // Comma-separated list of allowed browser origins (the Vite dev server by default).
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean),
  // Number of reverse proxies in front of the API (Caddy in production = 1). Needed so rate limiting
  // sees the real client IP from X-Forwarded-For instead of the proxy's.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
};
