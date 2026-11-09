import express, { type NextFunction, type Request, type Response } from 'express';
import {
  SqliteAuthService,
  type SqliteAuthRole,
  type SqliteAuthTokenPayload,
} from '../services/sqliteAuthService.js';

type AuthenticatedRequest = Request & { sqliteAuth?: SqliteAuthTokenPayload };

function requireSqliteAuth(service: SqliteAuthService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'جلسة الدخول مطلوبة.' });
    }

    const token = authorization.slice(7).trim();
    const payload = service.verifyToken(token);
    if (!payload) {
      return res.status(401).json({ success: false, error: 'جلسة الدخول غير صالحة أو منتهية.' });
    }
    req.sqliteAuth = payload;
    next();
  };
}

function requireSqliteRoles(...allowedRoles: SqliteAuthRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.sqliteAuth) {
      return res.status(401).json({ success: false, error: 'جلسة الدخول مطلوبة.' });
    }
    if (!allowedRoles.includes(req.sqliteAuth.role)) {
      return res.status(403).json({ success: false, error: 'ليست لديك صلاحية تنفيذ هذا الإجراء.' });
    }
    next();
  };
}

function clientIp(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || '127.0.0.1').slice(0, 64);
}

/**
 * Isolated SQLite auth router. Mount at /api/auth only after the host has
 * opened the intended database, run migrations, and imported the account set.
 * This router does not alter or replace the current JSON-backed server routes.
 */
export function createSqliteAuthRouter(service: SqliteAuthService): express.Router {
  const router = express.Router();
  const requireAuth = requireSqliteAuth(service);

  router.post('/login', (req: Request, res: Response) => {
    const { roleOrUsername, pin } = req.body || {};
    if (typeof roleOrUsername !== 'string' || !roleOrUsername.trim() ||
        typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: 'اسم المستخدم ورمز PIN المكوّن من 6 أرقام مطلوبان لتسجيل الدخول.',
      });
    }

    const result = service.authenticateUser(roleOrUsername, pin, clientIp(req));
    if (!result.success) {
      return res.status(result.locked ? 429 : 401).json({
        success: false,
        error: result.error || 'بيانات الاعتماد غير صحيحة.',
      });
    }
    return res.status(200).json({
      success: true,
      token: result.token,
      user: result.user,
    });
  });

  router.get('/session', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    return res.status(200).json({
      success: true,
      user: {
        id: req.sqliteAuth!.userId,
        username: req.sqliteAuth!.username,
        name: req.sqliteAuth!.name,
        role: req.sqliteAuth!.role,
        branchId: req.sqliteAuth!.branchId,
        branchName: req.sqliteAuth!.branchName,
      },
    });
  });

  router.post('/change-pin', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { currentPin, newPin } = req.body || {};
    const result = service.changePin(req.sqliteAuth!.username, currentPin, newPin);
    return res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/users', requireAuth, requireSqliteRoles('owner'), (req: Request, res: Response) => {
    const result = service.createUser(req.body || {});
    return res.status(result.success ? 201 : 400).json(result);
  });

  router.patch('/users/:userId/status', requireAuth, requireSqliteRoles('owner'), (req: Request, res: Response) => {
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'حالة الحساب يجب أن تكون true أو false.' });
    }
    const result = service.setUserActive(req.params.userId, isActive);
    return res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/users/:userId/reset-pin', requireAuth, requireSqliteRoles('owner'), (req: Request, res: Response) => {
    const { newPin } = req.body || {};
    const result = service.resetUserPin(req.params.userId, newPin);
    return res.status(result.success ? 200 : 400).json(result);
  });

  router.get('/users', requireAuth, requireSqliteRoles('owner', 'general_manager'), (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, users: service.getAllPublicUsers() });
  });

  router.get('/security-logs', requireAuth, requireSqliteRoles('owner', 'general_manager', 'auditor'), (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, logs: service.getSecurityLogs() });
  });

  return router;
}
