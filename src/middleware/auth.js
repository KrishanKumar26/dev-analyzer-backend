import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
const expirationMs = Number(process.env.JWT_EXPIRATION || 86400000);

export function generateToken(email) {
  return jwt.sign({}, secret, {
    subject: email,
    algorithm: 'HS256',
    expiresIn: Math.floor(expirationMs / 1000),
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] });
      req.email = payload.sub;
      return next();
    } catch {
      /* fall through */
    }
  }
  return res.sendStatus(403);
}
