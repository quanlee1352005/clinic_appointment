import { randomBytes } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";
import {
  clearStaffCookie,
  createAuthLimiter,
  emailPattern,
  hashToken,
  parseStaffToken,
  requireStaff,
  setStaffCookie,
  staffSessionLifetimeSeconds,
} from "./auth.js";
import {
  appendMessage,
  closeConsultation,
  loadMessages,
  messageLimiter,
  positiveInt,
} from "./consultations.js";

export const staffRouter = Router();
const staffAuthLimiter = createAuthLimiter();
const dummyHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);

const appointmentStatuses = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const statusLabels = {
  pending: "chờ xác nhận",
  confirmed: "đã xác nhận",
  completed: "đã hoàn thành",
  cancelled: "đã hủy",
  no_show: "không đến",
};

// Quy tắc chuyển trạng thái do nhân viên thực hiện.
const transitions = {
  confirmed: { from: ["pending"], time: "future" },
  cancelled: { from: ["pending", "confirmed"], time: null, noteRequired: true },
  completed: { from: ["confirmed"], time: "started" },
  no_show: { from: ["confirmed"], time: "started" },
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function hm(value) {
  return String(value).slice(0, 5);
}

function cleanNote(value, max = 500) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length > max) return undefined;
  return text || null;
}

// ---------- Đăng nhập nhân viên ----------
staffRouter.post("/auth/login", staffAuthLimiter, async (req, res) => {
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
    await pool.execute("DELETE FROM staff_sessions WHERE expires_at <= CURRENT_TIMESTAMP");
    const [rows] = await pool.execute(
      `SELECT staff_id AS staffId, full_name AS fullName, email, password_hash AS passwordHash
       FROM staff_accounts WHERE email = ? AND is_active = TRUE LIMIT 1`,
      [normalizedEmail],
    );
    const matches = await bcrypt.compare(password, rows[0]?.passwordHash ?? dummyHash);
    if (!rows[0] || !matches) {
      return res.status(401).json({ error: "Email hoặc mật khẩu không chính xác." });
    }

    const token = randomBytes(32).toString("base64url");
    await pool.execute(
      `INSERT INTO staff_sessions (staff_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`,
      [rows[0].staffId, hashToken(token), staffSessionLifetimeSeconds],
    );
    setStaffCookie(res, token);
    res.json({
      staff: { staffId: rows[0].staffId, fullName: rows[0].fullName, email: rows[0].email },
    });
  } catch (error) {
    console.error("Staff login failed:", error.message);
    res.status(500).json({ error: "Không đăng nhập được. Vui lòng thử lại." });
  }
});

staffRouter.post("/auth/logout", async (req, res) => {
  const token = parseStaffToken(req);
  try {
    if (token && token.length <= 100) {
      await pool.execute("DELETE FROM staff_sessions WHERE token_hash = ?", [hashToken(token)]);
    }
    clearStaffCookie(res);
    res.status(204).end();
  } catch (error) {
    console.error("Staff logout failed:", error.message);
    res.status(500).json({ error: "Không đăng xuất được." });
  }
});

staffRouter.get("/auth/me", requireStaff, (req, res) => {
  res.json({ staff: req.staff });
});

// Mọi API bên dưới chỉ dành cho nhân viên đã đăng nhập.
staffRouter.use(requireStaff);

// ---------- Tổng quan ----------
staffRouter.get("/summary", async (_req, res) => {
  try {
    const [[row]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM appointments WHERE status = 'pending') AS pendingAppointments,
        (SELECT COUNT(*) FROM appointments
          WHERE status IN ('pending', 'confirmed') AND DATE(start_at) = CURDATE()) AS todayAppointments,
        (SELECT COUNT(*) FROM consultations WHERE status = 'open') AS openConsultations
    `);
    res.json(row);
  } catch (error) {
    console.error("Staff summary failed:", error.message);
    res.status(500).json({ error: "Không tải được số liệu tổng quan." });
  }
});

// ---------- US-07: danh sách lịch hẹn ----------
staffRouter.get("/appointments", async (req, res) => {
  const status = req.query.status === undefined ? "pending" : String(req.query.status);
  const date = req.query.date === undefined || req.query.date === "" ? null : String(req.query.date);
  const doctorId =
    req.query.doctorId === undefined || req.query.doctorId === ""
      ? null
      : positiveInt(req.query.doctorId);

  if (
    (status !== "all" && !appointmentStatuses.includes(status)) ||
    (date !== null && !datePattern.test(date)) ||
    (req.query.doctorId && doctorId === null)
  ) {
    return res.status(400).json({ error: "Bộ lọc không hợp lệ." });
  }

  const where = [];
  const params = [];
  if (status !== "all") {
    where.push("a.status = ?");
    params.push(status);
  }
  if (date) {
    where.push("DATE(a.start_at) = ?");
    params.push(date);
  }
  if (doctorId) {
    where.push("a.doctor_id = ?");
    params.push(doctorId);
  }
  const order = status === "pending" || status === "confirmed" ? "ASC" : "DESC";

  try {
    const [rows] = await pool.execute(
      `SELECT a.appointment_id AS appointmentId, a.start_at AS startAt, a.end_at AS endAt,
              a.status, a.patient_note AS patientNote, a.staff_note AS staffNote,
              a.handled_at AS handledAt, hs.full_name AS handledBy,
              a.service_name_snapshot AS serviceName, a.price_snapshot AS price,
              a.doctor_id AS doctorId, d.full_name AS doctorName, sp.name AS specialty,
              p.patient_id AS patientId, p.full_name AS patientName,
              p.phone AS patientPhone, p.email AS patientEmail
       FROM appointments AS a
       JOIN patients AS p ON p.patient_id = a.patient_id
       JOIN doctors AS d ON d.doctor_id = a.doctor_id
       JOIN specialties AS sp ON sp.specialty_id = d.specialty_id
       LEFT JOIN staff_accounts AS hs ON hs.staff_id = a.handled_by_staff_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.start_at ${order}
       LIMIT 300`,
      params,
    );
    res.json(rows);
  } catch (error) {
    console.error("Staff appointments failed:", error.message);
    res.status(500).json({ error: "Không tải được danh sách lịch hẹn." });
  }
});

// ---------- US-08: xác nhận / từ chối / hoàn thành / không đến ----------
staffRouter.patch("/appointments/:id/status", async (req, res) => {
  const appointmentId = positiveInt(req.params.id);
  const target = req.body?.status;
  const rule = typeof target === "string" ? transitions[target] : undefined;
  const note = cleanNote(req.body?.note);
  if (!appointmentId || !rule || note === undefined) {
    return res.status(400).json({ error: "Yêu cầu xử lý lịch hẹn không hợp lệ." });
  }
  if (rule.noteRequired && (!note || note.length < 3)) {
    return res.status(400).json({ error: "Vui lòng nhập lý do (ít nhất 3 ký tự) khi từ chối hoặc hủy lịch." });
  }

  const timeCondition =
    rule.time === "future"
      ? "AND start_at > CURRENT_TIMESTAMP"
      : rule.time === "started"
        ? "AND start_at <= CURRENT_TIMESTAMP"
        : "";
  const fromPlaceholders = rule.from.map(() => "?").join(", ");

  try {
    const [result] = await pool.execute(
      `UPDATE appointments
       SET status = ?, staff_note = COALESCE(?, staff_note),
           handled_by_staff_id = ?, handled_at = CURRENT_TIMESTAMP
       WHERE appointment_id = ? AND status IN (${fromPlaceholders}) ${timeCondition}`,
      [target, note, req.staff.staffId, appointmentId, ...rule.from],
    );
    if (result.affectedRows > 0) {
      return res.json({ appointmentId, status: target });
    }

    // Không cập nhật được: giải thích lý do cho nhân viên.
    const [rows] = await pool.execute(
      `SELECT status, start_at > CURRENT_TIMESTAMP AS isFuture
       FROM appointments WHERE appointment_id = ?`,
      [appointmentId],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy lịch hẹn." });
    if (!rule.from.includes(rows[0].status)) {
      return res.status(409).json({
        error: `Lịch đang ở trạng thái "${statusLabels[rows[0].status]}" nên không thể chuyển sang "${statusLabels[target]}". Hãy tải lại danh sách.`,
      });
    }
    return res.status(409).json({
      error:
        rule.time === "future"
          ? "Lịch này đã qua giờ hẹn nên không thể xác nhận. Bạn có thể từ chối/hủy lịch."
          : "Chỉ đánh dấu hoàn thành hoặc không đến sau khi đã tới giờ hẹn.",
    });
  } catch (error) {
    console.error("Staff status update failed:", error.message);
    res.status(500).json({ error: "Không cập nhật được lịch hẹn." });
  }
});

// ---------- US-09: ca làm và ngày nghỉ của bác sĩ ----------
// Đếm lịch sắp tới (pending/confirmed) không còn nằm trong ca làm nào.
async function countUncovered(connection, doctorId) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS total FROM appointments AS a
     WHERE a.doctor_id = ? AND a.status IN ('pending', 'confirmed')
       AND a.start_at > CURRENT_TIMESTAMP
       AND NOT EXISTS (
         SELECT 1 FROM doctor_schedules AS s
         WHERE s.doctor_id = a.doctor_id AND s.is_active = TRUE
           AND s.day_of_week = DAYOFWEEK(a.start_at)
           AND s.start_time <= TIME(a.start_at) AND s.end_time >= TIME(a.end_at)
       )`,
    [doctorId],
  );
  return row.total;
}

function scheduleView(row) {
  return {
    scheduleId: row.scheduleId,
    doctorId: row.doctorId,
    dayOfWeek: row.dayOfWeek,
    startTime: hm(row.startTime),
    endTime: hm(row.endTime),
    isActive: Boolean(row.isActive),
  };
}

const scheduleColumns = `schedule_id AS scheduleId, doctor_id AS doctorId,
  day_of_week AS dayOfWeek, start_time AS startTime, end_time AS endTime, is_active AS isActive`;

staffRouter.get("/doctors", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.doctor_id AS doctorId, d.full_name AS fullName, sp.name AS specialty,
             d.is_active AS isActive
      FROM doctors AS d JOIN specialties AS sp ON sp.specialty_id = d.specialty_id
      ORDER BY d.full_name`);
    res.json(rows.map((row) => ({ ...row, isActive: Boolean(row.isActive) })));
  } catch (error) {
    console.error("Staff doctors failed:", error.message);
    res.status(500).json({ error: "Không tải được danh sách bác sĩ." });
  }
});

staffRouter.get("/doctors/:id/schedule", async (req, res) => {
  const doctorId = positiveInt(req.params.id);
  if (!doctorId) return res.status(400).json({ error: "Mã bác sĩ không hợp lệ." });
  try {
    const [doctors] = await pool.execute(
      `SELECT d.doctor_id AS doctorId, d.full_name AS fullName, sp.name AS specialty
       FROM doctors AS d JOIN specialties AS sp ON sp.specialty_id = d.specialty_id
       WHERE d.doctor_id = ?`,
      [doctorId],
    );
    if (doctors.length === 0) return res.status(404).json({ error: "Không tìm thấy bác sĩ." });

    const [schedules] = await pool.execute(
      `SELECT ${scheduleColumns} FROM doctor_schedules
       WHERE doctor_id = ? ORDER BY day_of_week, start_time`,
      [doctorId],
    );
    const [daysOff] = await pool.execute(
      `SELECT day_off_id AS dayOffId, off_date AS offDate, reason
       FROM doctor_days_off WHERE doctor_id = ? AND off_date >= CURDATE()
       ORDER BY off_date`,
      [doctorId],
    );
    res.json({
      doctor: doctors[0],
      schedules: schedules.map(scheduleView),
      daysOff,
      uncoveredAppointments: await countUncovered(pool, doctorId),
    });
  } catch (error) {
    console.error("Staff schedule failed:", error.message);
    res.status(500).json({ error: "Không tải được lịch làm việc." });
  }
});

function parseScheduleInput({ dayOfWeek, startTime, endTime }) {
  const day = Number(dayOfWeek);
  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > 7 ||
    !timePattern.test(String(startTime)) ||
    !timePattern.test(String(endTime)) ||
    String(startTime) >= String(endTime)
  ) {
    return null;
  }
  return { day, start: `${startTime}:00`, end: `${endTime}:00` };
}

async function hasOverlap(connection, doctorId, day, start, end, ignoreId = 0) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS total FROM doctor_schedules
     WHERE doctor_id = ? AND day_of_week = ? AND is_active = TRUE
       AND schedule_id <> ? AND start_time < ? AND end_time > ?`,
    [doctorId, day, ignoreId, end, start],
  );
  return row.total > 0;
}

const overlapMessage = "Ca làm bị trùng với một ca đang bật trong cùng ngày.";
const duplicateMessage = "Đã có ca bắt đầu đúng giờ này trong ngày (có thể đang tắt). Hãy sửa hoặc bật lại ca đó.";

staffRouter.post("/doctors/:id/schedules", async (req, res) => {
  const doctorId = positiveInt(req.params.id);
  const input = parseScheduleInput(req.body ?? {});
  if (!doctorId || !input) {
    return res.status(400).json({ error: "Ca làm không hợp lệ: chọn thứ, giờ bắt đầu phải trước giờ kết thúc." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [doctor] = await connection.execute(
      "SELECT doctor_id FROM doctors WHERE doctor_id = ? FOR UPDATE",
      [doctorId],
    );
    if (doctor.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Không tìm thấy bác sĩ." });
    }
    if (await hasOverlap(connection, doctorId, input.day, input.start, input.end)) {
      await connection.rollback();
      return res.status(409).json({ error: overlapMessage });
    }
    const [result] = await connection.execute(
      `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
       VALUES (?, ?, ?, ?)`,
      [doctorId, input.day, input.start, input.end],
    );
    await connection.commit();
    res.status(201).json({ scheduleId: result.insertId });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // bỏ qua lỗi rollback
    }
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: duplicateMessage });
    console.error("Schedule create failed:", error.message);
    res.status(500).json({ error: "Không thêm được ca làm." });
  } finally {
    connection.release();
  }
});

staffRouter.patch("/schedules/:id", async (req, res) => {
  const scheduleId = positiveInt(req.params.id);
  if (!scheduleId) return res.status(400).json({ error: "Mã ca làm không hợp lệ." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT ${scheduleColumns} FROM doctor_schedules WHERE schedule_id = ? FOR UPDATE`,
      [scheduleId],
    );
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Không tìm thấy ca làm." });
    }
    const current = scheduleView(rows[0]);
    const body = req.body ?? {};
    const input = parseScheduleInput({
      dayOfWeek: current.dayOfWeek,
      startTime: body.startTime ?? current.startTime,
      endTime: body.endTime ?? current.endTime,
    });
    const isActive = body.isActive === undefined ? current.isActive : body.isActive === true;
    if (!input || (body.isActive !== undefined && typeof body.isActive !== "boolean")) {
      await connection.rollback();
      return res.status(400).json({ error: "Giờ bắt đầu phải trước giờ kết thúc (định dạng HH:MM)." });
    }
    if (isActive && (await hasOverlap(connection, current.doctorId, input.day, input.start, input.end, scheduleId))) {
      await connection.rollback();
      return res.status(409).json({ error: overlapMessage });
    }
    await connection.execute(
      "UPDATE doctor_schedules SET start_time = ?, end_time = ?, is_active = ? WHERE schedule_id = ?",
      [input.start, input.end, isActive, scheduleId],
    );
    const uncovered = await countUncovered(connection, current.doctorId);
    await connection.commit();
    res.json({ scheduleId, uncoveredAppointments: uncovered });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // bỏ qua lỗi rollback
    }
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: duplicateMessage });
    console.error("Schedule update failed:", error.message);
    res.status(500).json({ error: "Không cập nhật được ca làm." });
  } finally {
    connection.release();
  }
});

staffRouter.delete("/schedules/:id", async (req, res) => {
  const scheduleId = positiveInt(req.params.id);
  if (!scheduleId) return res.status(400).json({ error: "Mã ca làm không hợp lệ." });
  try {
    const [rows] = await pool.execute(
      "SELECT doctor_id AS doctorId FROM doctor_schedules WHERE schedule_id = ?",
      [scheduleId],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy ca làm." });
    await pool.execute("DELETE FROM doctor_schedules WHERE schedule_id = ?", [scheduleId]);
    res.json({ uncoveredAppointments: await countUncovered(pool, rows[0].doctorId) });
  } catch (error) {
    console.error("Schedule delete failed:", error.message);
    res.status(500).json({ error: "Không xóa được ca làm." });
  }
});

staffRouter.post("/doctors/:id/days-off", async (req, res) => {
  const doctorId = positiveInt(req.params.id);
  const offDate = typeof req.body?.offDate === "string" ? req.body.offDate : "";
  const reason = cleanNote(req.body?.reason, 255);
  if (!doctorId || !datePattern.test(offDate) || reason === undefined) {
    return res.status(400).json({ error: "Ngày nghỉ hoặc lý do chưa hợp lệ." });
  }

  try {
    const [[check]] = await pool.execute("SELECT ? >= CURDATE() AS ok", [offDate]);
    if (!check.ok) return res.status(400).json({ error: "Ngày nghỉ phải từ hôm nay trở đi." });
    const [doctor] = await pool.execute("SELECT doctor_id FROM doctors WHERE doctor_id = ?", [doctorId]);
    if (doctor.length === 0) return res.status(404).json({ error: "Không tìm thấy bác sĩ." });

    await pool.execute(
      "INSERT INTO doctor_days_off (doctor_id, off_date, reason) VALUES (?, ?, ?)",
      [doctorId, offDate, reason],
    );
    const [[affected]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM appointments
       WHERE doctor_id = ? AND DATE(start_at) = ? AND status IN ('pending', 'confirmed')`,
      [doctorId, offDate],
    );
    res.status(201).json({ affectedAppointments: affected.total });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ngày này đã được đánh dấu nghỉ." });
    }
    if (error.code === "ER_TRUNCATED_WRONG_VALUE" || error.code === "ER_WRONG_VALUE") {
      return res.status(400).json({ error: "Ngày nghỉ không hợp lệ." });
    }
    console.error("Day off create failed:", error.message);
    res.status(500).json({ error: "Không thêm được ngày nghỉ." });
  }
});

staffRouter.delete("/days-off/:id", async (req, res) => {
  const dayOffId = positiveInt(req.params.id);
  if (!dayOffId) return res.status(400).json({ error: "Mã ngày nghỉ không hợp lệ." });
  try {
    const [result] = await pool.execute("DELETE FROM doctor_days_off WHERE day_off_id = ?", [dayOffId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Không tìm thấy ngày nghỉ." });
    res.status(204).end();
  } catch (error) {
    console.error("Day off delete failed:", error.message);
    res.status(500).json({ error: "Không xóa được ngày nghỉ." });
  }
});

// ---------- Tư vấn trực tuyến (phía nhân viên) ----------
const consultationStatuses = ["open", "answered", "closed"];

staffRouter.get("/consultations", async (req, res) => {
  const status = req.query.status === undefined ? "open" : String(req.query.status);
  if (status !== "all" && !consultationStatuses.includes(status)) {
    return res.status(400).json({ error: "Bộ lọc không hợp lệ." });
  }
  try {
    const [rows] = await pool.execute(
      `SELECT c.consultation_id AS consultationId, c.subject, c.status,
              sp.name AS specialty, p.full_name AS patientName, p.phone AS patientPhone,
              c.created_at AS createdAt, c.updated_at AS updatedAt,
              (SELECT m.body FROM consultation_messages AS m
               WHERE m.consultation_id = c.consultation_id
               ORDER BY m.message_id DESC LIMIT 1) AS lastMessage
       FROM consultations AS c
       JOIN patients AS p ON p.patient_id = c.patient_id
       LEFT JOIN specialties AS sp ON sp.specialty_id = c.specialty_id
       ${status === "all" ? "" : "WHERE c.status = ?"}
       ORDER BY c.updated_at ${status === "open" ? "ASC" : "DESC"}
       LIMIT 200`,
      status === "all" ? [] : [status],
    );
    res.json(rows);
  } catch (error) {
    console.error("Staff consultations failed:", error.message);
    res.status(500).json({ error: "Không tải được danh sách tư vấn." });
  }
});

staffRouter.get("/consultations/:id", async (req, res) => {
  const consultationId = positiveInt(req.params.id);
  if (!consultationId) return res.status(400).json({ error: "Mã tư vấn không hợp lệ." });
  try {
    const [rows] = await pool.execute(
      `SELECT c.consultation_id AS consultationId, c.subject, c.status,
              sp.name AS specialty, c.created_at AS createdAt,
              p.full_name AS patientName, p.phone AS patientPhone, p.email AS patientEmail
       FROM consultations AS c
       JOIN patients AS p ON p.patient_id = c.patient_id
       LEFT JOIN specialties AS sp ON sp.specialty_id = c.specialty_id
       WHERE c.consultation_id = ?`,
      [consultationId],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy cuộc tư vấn." });
    res.json({ consultation: rows[0], messages: await loadMessages(consultationId) });
  } catch (error) {
    console.error("Staff consultation detail failed:", error.message);
    res.status(500).json({ error: "Không tải được cuộc tư vấn." });
  }
});

staffRouter.post("/consultations/:id/messages", messageLimiter, async (req, res) => {
  const consultationId = positiveInt(req.params.id);
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!consultationId || body.length < 1 || body.length > 2000) {
    return res.status(400).json({ error: "Tin nhắn cần từ 1 đến 2000 ký tự." });
  }
  try {
    const result = await appendMessage({ consultationId, staffId: req.staff.staffId, body });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ messages: await loadMessages(consultationId) });
  } catch (error) {
    console.error("Staff reply failed:", error.message);
    res.status(500).json({ error: "Không gửi được phản hồi." });
  }
});

staffRouter.patch("/consultations/:id/close", async (req, res) => {
  const consultationId = positiveInt(req.params.id);
  if (!consultationId) return res.status(400).json({ error: "Mã tư vấn không hợp lệ." });
  try {
    if (!(await closeConsultation(consultationId))) {
      return res.status(404).json({ error: "Không tìm thấy cuộc tư vấn đang mở." });
    }
    res.json({ consultationId, status: "closed" });
  } catch (error) {
    console.error("Staff close consultation failed:", error.message);
    res.status(500).json({ error: "Không kết thúc được cuộc tư vấn." });
  }
});
