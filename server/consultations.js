import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { pool } from "./db.js";

const maxActivePerPatient = 5;

export const messageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Bạn gửi tin nhắn quá nhanh. Vui lòng đợi vài phút rồi thử lại." },
});

export function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

function cleanText(value, min, max) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
}

// Lấy toàn bộ luồng tin nhắn của một cuộc tư vấn (đã kiểm tra quyền ở nơi gọi).
export async function loadMessages(consultationId) {
  const [rows] = await pool.execute(
    `SELECT m.message_id AS messageId, m.sender_type AS senderType,
            m.body, m.created_at AS createdAt,
            CASE WHEN m.sender_type = 'staff' THEN st.full_name ELSE p.full_name END AS senderName
     FROM consultation_messages AS m
     JOIN consultations AS c ON c.consultation_id = m.consultation_id
     JOIN patients AS p ON p.patient_id = c.patient_id
     LEFT JOIN staff_accounts AS st ON st.staff_id = m.staff_id
     WHERE m.consultation_id = ?
     ORDER BY m.message_id ASC`,
    [consultationId],
  );
  return rows;
}

// Thêm tin nhắn trong một transaction: khóa cuộc tư vấn, chặn khi đã đóng,
// rồi cập nhật trạng thái (nhân viên trả lời -> answered, bệnh nhân -> open).
export async function appendMessage({ consultationId, patientId = null, staffId = null, body }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const params = [consultationId];
    let ownerFilter = "";
    if (patientId) {
      ownerFilter = "AND patient_id = ?";
      params.push(patientId);
    }
    const [rows] = await connection.execute(
      `SELECT status FROM consultations
       WHERE consultation_id = ? ${ownerFilter} FOR UPDATE`,
      params,
    );
    if (rows.length === 0) {
      await connection.rollback();
      return { status: 404, error: "Không tìm thấy cuộc tư vấn." };
    }
    if (rows[0].status === "closed") {
      await connection.rollback();
      return { status: 409, error: "Cuộc tư vấn đã kết thúc. Hãy tạo yêu cầu mới nếu cần hỏi thêm." };
    }

    await connection.execute(
      `INSERT INTO consultation_messages (consultation_id, sender_type, staff_id, body)
       VALUES (?, ?, ?, ?)`,
      [consultationId, staffId ? "staff" : "patient", staffId, body],
    );
    await connection.execute(
      "UPDATE consultations SET status = ? WHERE consultation_id = ?",
      [staffId ? "answered" : "open", consultationId],
    );
    await connection.commit();
    return { status: 201 };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // bỏ qua lỗi rollback
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeConsultation(consultationId, patientId = null) {
  const params = [consultationId];
  let ownerFilter = "";
  if (patientId) {
    ownerFilter = "AND patient_id = ?";
    params.push(patientId);
  }
  const [result] = await pool.execute(
    `UPDATE consultations SET status = 'closed', closed_at = CURRENT_TIMESTAMP
     WHERE consultation_id = ? ${ownerFilter} AND status <> 'closed'`,
    params,
  );
  return result.affectedRows > 0;
}

// ---- API bệnh nhân (đã gắn requirePatient ở index.js) ----
export const patientConsultationsRouter = Router();

patientConsultationsRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.consultation_id AS consultationId, c.subject, c.status,
              sp.name AS specialty, c.created_at AS createdAt, c.updated_at AS updatedAt,
              (SELECT m.body FROM consultation_messages AS m
               WHERE m.consultation_id = c.consultation_id
               ORDER BY m.message_id DESC LIMIT 1) AS lastMessage
       FROM consultations AS c
       LEFT JOIN specialties AS sp ON sp.specialty_id = c.specialty_id
       WHERE c.patient_id = ?
       ORDER BY c.updated_at DESC
       LIMIT 100`,
      [req.user.patientId],
    );
    res.json(rows);
  } catch (error) {
    console.error("Consultation list failed:", error.message);
    res.status(500).json({ error: "Không tải được danh sách tư vấn." });
  }
});

patientConsultationsRouter.get("/specialties", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT specialty_id AS specialtyId, name FROM specialties ORDER BY name",
    );
    res.json(rows);
  } catch (error) {
    console.error("Specialty list failed:", error.message);
    res.status(500).json({ error: "Không tải được danh sách chuyên khoa." });
  }
});

patientConsultationsRouter.post("/", messageLimiter, async (req, res) => {
  const { subject, message, specialtyId } = req.body ?? {};
  const cleanSubject = cleanText(subject, 3, 160);
  const cleanBody = cleanText(message, 5, 2000);
  const specialty =
    specialtyId === undefined || specialtyId === null || specialtyId === ""
      ? null
      : positiveInt(specialtyId);
  if (!cleanSubject || !cleanBody || (specialtyId && specialty === null)) {
    return res.status(400).json({
      error: "Vui lòng nhập tiêu đề (3-160 ký tự) và nội dung câu hỏi (5-2000 ký tự).",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Khóa hàng bệnh nhân để hai yêu cầu gửi cùng lúc không vượt giới hạn.
    await connection.execute("SELECT patient_id FROM patients WHERE patient_id = ? FOR UPDATE", [
      req.user.patientId,
    ]);
    const [[active]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM consultations
       WHERE patient_id = ? AND status <> 'closed'`,
      [req.user.patientId],
    );
    if (active.total >= maxActivePerPatient) {
      await connection.rollback();
      return res.status(409).json({
        error: `Bạn đang có ${maxActivePerPatient} cuộc tư vấn chưa kết thúc. Hãy kết thúc bớt trước khi tạo mới.`,
      });
    }
    if (specialty) {
      const [found] = await connection.execute(
        "SELECT specialty_id FROM specialties WHERE specialty_id = ?",
        [specialty],
      );
      if (found.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: "Chuyên khoa không hợp lệ." });
      }
    }

    const [created] = await connection.execute(
      "INSERT INTO consultations (patient_id, specialty_id, subject) VALUES (?, ?, ?)",
      [req.user.patientId, specialty, cleanSubject],
    );
    await connection.execute(
      `INSERT INTO consultation_messages (consultation_id, sender_type, body)
       VALUES (?, 'patient', ?)`,
      [created.insertId, cleanBody],
    );
    await connection.commit();
    res.status(201).json({ consultationId: created.insertId });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // bỏ qua lỗi rollback
    }
    console.error("Consultation creation failed:", error.message);
    res.status(500).json({ error: "Không gửi được yêu cầu tư vấn. Vui lòng thử lại." });
  } finally {
    connection.release();
  }
});

patientConsultationsRouter.get("/:id", async (req, res) => {
  const consultationId = positiveInt(req.params.id);
  if (!consultationId) return res.status(400).json({ error: "Mã tư vấn không hợp lệ." });

  try {
    const [rows] = await pool.execute(
      `SELECT c.consultation_id AS consultationId, c.subject, c.status,
              sp.name AS specialty, c.created_at AS createdAt, c.updated_at AS updatedAt
       FROM consultations AS c
       LEFT JOIN specialties AS sp ON sp.specialty_id = c.specialty_id
       WHERE c.consultation_id = ? AND c.patient_id = ?`,
      [consultationId, req.user.patientId],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy cuộc tư vấn." });
    res.json({ consultation: rows[0], messages: await loadMessages(consultationId) });
  } catch (error) {
    console.error("Consultation detail failed:", error.message);
    res.status(500).json({ error: "Không tải được cuộc tư vấn." });
  }
});

patientConsultationsRouter.post("/:id/messages", messageLimiter, async (req, res) => {
  const consultationId = positiveInt(req.params.id);
  const body = cleanText(req.body?.body, 1, 2000);
  if (!consultationId || !body) {
    return res.status(400).json({ error: "Tin nhắn cần từ 1 đến 2000 ký tự." });
  }
  try {
    const result = await appendMessage({
      consultationId,
      patientId: req.user.patientId,
      body,
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ messages: await loadMessages(consultationId) });
  } catch (error) {
    console.error("Consultation message failed:", error.message);
    res.status(500).json({ error: "Không gửi được tin nhắn." });
  }
});

patientConsultationsRouter.patch("/:id/close", async (req, res) => {
  const consultationId = positiveInt(req.params.id);
  if (!consultationId) return res.status(400).json({ error: "Mã tư vấn không hợp lệ." });
  try {
    const closed = await closeConsultation(consultationId, req.user.patientId);
    if (!closed) {
      return res.status(404).json({ error: "Không tìm thấy cuộc tư vấn đang mở." });
    }
    res.json({ consultationId, status: "closed" });
  } catch (error) {
    console.error("Consultation close failed:", error.message);
    res.status(500).json({ error: "Không kết thúc được cuộc tư vấn." });
  }
});
