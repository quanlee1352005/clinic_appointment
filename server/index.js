import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import "dotenv/config";
import { pool } from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const sessionCookie = "clinic_session";
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(["/api/auth", "/api/appointments"], (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Bạn thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại." },
});

function parseSessionToken(req) {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return null;

  const cookiePart = rawCookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`));
  if (!cookiePart) return null;

  try {
    return decodeURIComponent(cookiePart.slice(sessionCookie.length + 1));
  } catch {
    return null;
  }
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}${secure}`,
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

function publicUser(row) {
  return {
    accountId: row.accountId,
    patientId: row.patientId,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
  };
}

async function requirePatient(req, res, next) {
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

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(503).json({ error: "Không thể kết nối cơ sở dữ liệu." });
  }
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { fullName, phone, email, password } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (
    typeof fullName !== "string" ||
    fullName.trim().length < 2 ||
    fullName.trim().length > 160 ||
    typeof phone !== "string" ||
    !/^[0-9+().\-\s]{8,20}$/.test(phone.trim()) ||
    normalizedEmail.length > 254 ||
    !emailPattern.test(normalizedEmail) ||
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 72
  ) {
    return res.status(400).json({
      error: "Họ tên, số điện thoại hoặc email chưa hợp lệ. Mật khẩu cần từ 10 đến 72 ký tự.",
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      "DELETE FROM login_sessions WHERE expires_at <= CURRENT_TIMESTAMP",
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const [patientResult] = await connection.execute(
      "INSERT INTO patients (full_name, phone, email) VALUES (?, ?, ?)",
      [fullName.trim(), phone.trim(), normalizedEmail],
    );
    const [accountResult] = await connection.execute(
      "INSERT INTO patient_accounts (patient_id, email, password_hash) VALUES (?, ?, ?)",
      [patientResult.insertId, normalizedEmail, passwordHash],
    );

    const token = randomBytes(32).toString("base64url");
    await connection.execute(
      `INSERT INTO login_sessions (account_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`,
      [accountResult.insertId, hashToken(token), sessionLifetimeSeconds],
    );
    await connection.commit();
    setSessionCookie(res, token);
    res.status(201).json({
      user: {
        accountId: accountResult.insertId,
        patientId: patientResult.insertId,
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: normalizedEmail,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Account registration rollback failed:", rollbackError.message);
      }
    }
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email này đã được sử dụng." });
    }
    console.error("Account registration failed:", error.message);
    return res.status(500).json({ error: "Không tạo được tài khoản. Vui lòng thử lại." });
  } finally {
    connection?.release();
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    normalizedEmail.length > 254 ||
    !emailPattern.test(normalizedEmail) ||
    typeof password !== "string" ||
    password.length > 72
  ) {
    return res.status(400).json({ error: "Email hoặc mật khẩu chưa hợp lệ." });
  }

  try {
    await pool.execute(
      "DELETE FROM login_sessions WHERE expires_at <= CURRENT_TIMESTAMP",
    );
    const [rows] = await pool.execute(
      `SELECT a.account_id AS accountId, p.patient_id AS patientId,
              p.full_name AS fullName, p.phone, a.email, a.password_hash AS passwordHash
       FROM patient_accounts AS a
       JOIN patients AS p ON p.patient_id = a.patient_id
       WHERE a.email = ? AND p.is_active = TRUE
       LIMIT 1`,
      [normalizedEmail],
    );

    const storedHash = rows[0]?.passwordHash ?? dummyPasswordHash;
    const passwordMatches = await bcrypt.compare(password, storedHash);
    if (!rows[0] || !passwordMatches) {
      return res.status(401).json({ error: "Email hoặc mật khẩu không chính xác." });
    }

    const token = randomBytes(32).toString("base64url");
    await pool.execute(
      `INSERT INTO login_sessions (account_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`,
      [rows[0].accountId, hashToken(token), sessionLifetimeSeconds],
    );
    setSessionCookie(res, token);
    res.json({ user: publicUser(rows[0]) });
  } catch (error) {
    console.error("Login failed:", error.message);
    res.status(500).json({ error: "Không đăng nhập được. Vui lòng thử lại." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = parseSessionToken(req);
  try {
    if (token && token.length <= 100) {
      await pool.execute("DELETE FROM login_sessions WHERE token_hash = ?", [hashToken(token)]);
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    console.error("Logout failed:", error.message);
    res.status(500).json({ error: "Không đăng xuất được. Vui lòng thử lại." });
  }
});

app.get("/api/auth/me", requirePatient, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/catalog", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ds.doctor_id AS doctorId, d.full_name AS doctorName,
             sp.name AS specialty, ds.service_id AS serviceId,
             s.name AS serviceName, s.description AS serviceDescription,
             ds.duration_minutes AS durationMinutes, ds.price
      FROM doctor_services AS ds
      JOIN doctors AS d ON d.doctor_id = ds.doctor_id
      JOIN specialties AS sp ON sp.specialty_id = d.specialty_id
      JOIN services AS s ON s.service_id = ds.service_id
      WHERE ds.is_active = TRUE AND d.is_active = TRUE AND s.is_active = TRUE
      ORDER BY s.name, d.full_name
    `);
    res.json(rows);
  } catch (error) {
    console.error("Catalog request failed:", error.message);
    res.status(500).json({ error: "Không tải được danh sách dịch vụ." });
  }
});

app.get("/api/appointments", requirePatient, async (req, res) => {
  const date = req.query.date;
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: "Ngày lọc không hợp lệ." });
  }

  try {
    const params = [req.user.patientId];
    let dateFilter = "";
    if (date) {
      dateFilter = "AND DATE(a.start_at) = ?";
      params.push(date);
    }
    const [rows] = await pool.execute(
      `SELECT a.appointment_id AS appointmentId, a.start_at AS startAt,
              a.end_at AS endAt, a.status, a.patient_note AS patientNote,
              a.service_name_snapshot AS serviceName, a.price_snapshot AS price,
              d.full_name AS doctorName, sp.name AS specialty
       FROM appointments AS a
       JOIN doctors AS d ON d.doctor_id = a.doctor_id
       JOIN specialties AS sp ON sp.specialty_id = d.specialty_id
       WHERE a.patient_id = ? ${dateFilter}
       ORDER BY a.start_at DESC
       LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (error) {
    console.error("Patient appointments request failed:", error.message);
    res.status(500).json({ error: "Không tải được lịch khám của bạn." });
  }
});

app.post("/api/appointments", requirePatient, async (req, res) => {
  const { doctorId, serviceId, startAt, note = "" } = req.body ?? {};
  if (
    !Number.isSafeInteger(Number(doctorId)) ||
    Number(doctorId) < 1 ||
    !Number.isSafeInteger(Number(serviceId)) ||
    Number(serviceId) < 1 ||
    typeof startAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt) ||
    Number.isNaN(new Date(startAt).getTime()) ||
    typeof note !== "string" ||
    note.length > 1000
  ) {
    return res.status(400).json({ error: "Thông tin đặt lịch chưa hợp lệ." });
  }

  try {
    const mysqlDateTime = `${startAt.replace("T", " ")}:00`;
    const [resultSets] = await pool.query("CALL sp_create_appointment(?, ?, ?, ?, ?)", [
      req.user.patientId,
      Number(doctorId),
      Number(serviceId),
      mysqlDateTime,
      note.trim() || null,
    ]);
    const appointmentId = resultSets?.[0]?.appointment_id;
    if (!appointmentId) {
      throw new Error("The booking procedure did not return an appointment ID.");
    }
    const [rows] = await pool.execute(
      `SELECT appointment_id AS appointmentId, start_at AS startAt,
              end_at AS endAt, status, service_name_snapshot AS serviceName,
              price_snapshot AS price
       FROM appointments
       WHERE appointment_id = ? AND patient_id = ?`,
      [appointmentId, req.user.patientId],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.sqlState === "45000") {
      return res.status(409).json({ error: error.sqlMessage });
    }
    console.error("Appointment creation failed:", error.message);
    res.status(500).json({ error: "Không thể tạo lịch hẹn. Vui lòng thử lại." });
  }
});

app.patch("/api/appointments/:id/cancel", requirePatient, async (req, res) => {
  const appointmentId = Number(req.params.id);
  if (!Number.isSafeInteger(appointmentId) || appointmentId < 1) {
    return res.status(400).json({ error: "Mã lịch hẹn không hợp lệ." });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE appointments
       SET status = 'cancelled'
       WHERE appointment_id = ?
         AND patient_id = ?
         AND status IN ('pending', 'confirmed')
         AND start_at > CURRENT_TIMESTAMP`,
      [appointmentId, req.user.patientId],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Không tìm thấy lịch có thể hủy trong tài khoản của bạn." });
    }
    res.json({ appointmentId, status: "cancelled" });
  } catch (error) {
    console.error("Appointment cancellation failed:", error.message);
    res.status(500).json({ error: "Không hủy được lịch hẹn." });
  }
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled request error:", error);
  res.status(500).json({ error: "Đã xảy ra lỗi hệ thống." });
});

app.listen(port, () => {
  console.log(`Clinic API listening on http://localhost:${port}`);
});
