import { createHash } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { pool } from "./db.js";

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const sessionLifetimeSeconds = 7 * 24 * 60 * 60; // bệnh nhân: 7 ngày
export const staffSessionLifetimeSeconds = 12 * 60 * 60; // nhân viên: 12 giờ

const patientCookie = "clinic_session";
const staffCookie = "clinic_staff_session";

function readCookie(req, name) {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return null;

  const cookiePart = rawCookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookiePart) return null;

  try {
    return decodeURIComponent(cookiePart.slice(name.length + 1));
  } catch {
    return null;
  }
}

function writeCookie(res, name, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// ---- Bệnh nhân ----
export const parseSessionToken = (req) => readCookie(req, patientCookie);
export const setSessionCookie = (res, token) =>
  writeCookie(res, patientCookie, token, sessionLifetimeSeconds);
export const clearSessionCookie = (res) => writeCookie(res, patientCookie, "", 0);

// ---- Nhân viên (cookie riêng, bảng phiên riêng) ----
export const parseStaffToken = (req) => readCookie(req, staffCookie);
export const setStaffCookie = (res, token) =>
  writeCookie(res, staffCookie, token, staffSessionLifetimeSeconds);
export const clearStaffCookie = (res) => writeCookie(res, staffCookie, "", 0);

export function publicUser(row) {
  return {
    accountId: row.accountId,
    patientId: row.patientId,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
  };
}

export function createAuthLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Bạn thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại." },
  });
}

export const authLimiter = createAuthLimiter();

export async function requirePatient(req, res, next) {
  const token = parseSessionToken(req);
  if (!token || token.length > 100) {
    return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT a.account_id AS accountId, p.patient_id AS patientId,
              p.full_name AS fullName, p.phone, a.email
       FROM login_sessions AS s
       JOIN patient_accounts AS a ON a.account_id = s.account_id
       JOIN patients AS p ON p.patient_id = a.patient_id
       WHERE s.token_hash = ?
         AND s.expires_at > CURRENT_TIMESTAMP
         AND p.is_active = TRUE`,
      [hashToken(token)],
    );
    if (rows.length === 0) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
    }
    req.user = publicUser(rows[0]);
    return next();
  } catch (error) {
    console.error("Session validation failed:", error.message);
    return res.status(500).json({ error: "Không xác thực được phiên đăng nhập." });
  }
}

export async function requireStaff(req, res, next) {
  const token = parseStaffToken(req);
  if (!token || token.length > 100) {
    return res.status(401).json({ error: "Vui lòng đăng nhập tài khoản nhân viên." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT a.staff_id AS staffId, a.full_name AS fullName, a.email
       FROM staff_sessions AS s
       JOIN staff_accounts AS a ON a.staff_id = s.staff_id
       WHERE s.token_hash = ?
         AND s.expires_at > CURRENT_TIMESTAMP
         AND a.is_active = TRUE`,
      [hashToken(token)],
    );
    if (rows.length === 0) {
      clearStaffCookie(res);
      return res.status(401).json({ error: "Phiên nhân viên đã hết hạn. Vui lòng đăng nhập lại." });
    }
    req.staff = rows[0];
    return next();
  } catch (error) {
    console.error("Staff session validation failed:", error.message);
    return res.status(500).json({ error: "Không xác thực được phiên đăng nhập." });
  }
}
