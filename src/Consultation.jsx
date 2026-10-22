import { useEffect, useRef, useState } from "react";
import { formatDateTime, request } from "./api.js";

export const consultationStatus = {
  open: "Đang chờ phản hồi",
  answered: "Đã có phản hồi",
  closed: "Đã kết thúc",
};

// Tải lại dữ liệu định kỳ (không dùng AI hay WebSocket: đơn giản là hỏi lại máy chủ).
export function usePolling(callback, delay, active) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => saved.current(), delay);
    return () => clearInterval(timer);
  }, [delay, active]);
}

// Khung hiển thị tin nhắn, dùng chung cho bệnh nhân và nhân viên.
export function ChatThread({ messages, ownType }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  return (
    <div className="chat-thread" aria-live="polite">
      {messages.map((message) => (
        <div key={message.messageId} className={`chat-msg ${message.senderType === ownType ? "mine" : "theirs"}`}>
          <span className="chat-author">
            {message.senderType === "staff" ? `Phòng khám · ${message.senderName}` : message.senderName}
          </span>
          <p>{message.body}</p>
          <small>{formatDateTime(message.createdAt)}</small>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Consultation() {
  const [list, setList] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ subject: "", specialtyId: "", message: "" });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadList() {
    try {
      setList(await request("/api/consultations"));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    try {
      setDetail(await request(`/api/consultations/${id}`));
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadList();
    request("/api/consultations/specialties").then(setSpecialties).catch(() => {});
  }, []);

  useEffect(() => {
    setDetail(null);
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  const isLive = Boolean(selectedId) && detail?.consultation.status !== "closed";
  usePolling(() => {
    loadDetail(selectedId);
    loadList();
  }, 8000, isLive);

  function startCompose() {
    setError("");
    setNotice("");
    setSelectedId(null);
    setComposing(true);
  }

  function openThread(id) {
    setError("");
    setNotice("");
    setComposing(false);
    setSelectedId(id);
  }

  async function createConsultation(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/consultations", {
        method: "POST",
        body: JSON.stringify({ ...form, specialtyId: form.specialtyId || null }),
      });
      setForm({ subject: "", specialtyId: "", message: "" });
      setComposing(false);
      setSelectedId(result.consultationId);
      setNotice("Đã gửi yêu cầu tư vấn. Nhân viên phòng khám sẽ phản hồi trong giờ làm việc.");
      await loadList();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await request(`/api/consultations/${selectedId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      setDetail((current) => ({
        consultation: { ...current.consultation, status: "open" },
        messages: result.messages,
      }));
      await loadList();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  async function closeThread() {
    if (!window.confirm("Kết thúc cuộc tư vấn này? Bạn sẽ không nhắn thêm được nữa.")) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/consultations/${selectedId}/close`, { method: "PATCH" });
      setNotice("Cuộc tư vấn đã được kết thúc.");
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (closeError) {
      setError(closeError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-section">
      <div className="account-heading">
        <div>
          <span className="eyebrow">TƯ VẤN TRỰC TUYẾN</span>
          <h1>Trao đổi cùng phòng khám</h1>
          <p>Gửi câu hỏi và nhận phản hồi từ nhân viên phòng khám — do người thật trả lời, không dùng AI.</p>
        </div>
        <button className="button button-primary" onClick={startCompose}>+ Câu hỏi mới</button>
      </div>
      <div className="alert info" role="note">
        Tư vấn trực tuyến không thay thế việc khám trực tiếp. Trường hợp khẩn cấp, hãy gọi 115 hoặc đến cơ sở y tế gần nhất.
      </div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="consult-layout">
        <aside className="consult-list">
          {loading ? <p className="empty-state">Đang tải...</p> : list.length === 0 ? (
            <p className="empty-state">Bạn chưa có yêu cầu tư vấn nào.</p>
          ) : list.map((item) => (
            <button key={item.consultationId} className={item.consultationId === selectedId ? "consult-item active" : "consult-item"} onClick={() => openThread(item.consultationId)}>
              <span className="consult-item-top">
                <b>{item.subject}</b>
                <span className={`status consult-${item.status}`}>{consultationStatus[item.status]}</span>
              </span>
              <small>{item.specialty ? `${item.specialty} · ` : ""}{formatDateTime(item.updatedAt)}</small>
              <span className="consult-snippet">{item.lastMessage}</span>
            </button>
          ))}
        </aside>

        <div className="consult-panel">
          {composing && (
            <form onSubmit={createConsultation}>
              <div className="form-title"><span className="step-number">01</span><div><h3>Câu hỏi của bạn</h3><p>Mô tả ngắn gọn để nhân viên hỗ trợ nhanh hơn</p></div></div>
              <div className="form-grid">
                <label className="field full"><span>Tiêu đề <i>*</i></span><input required minLength="3" maxLength="160" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Ví dụ: Đau đầu kéo dài nên khám khoa nào?" /></label>
                <label className="field full"><span>Chuyên khoa quan tâm <small>(không bắt buộc)</small></span>
                  <select value={form.specialtyId} onChange={(event) => setForm({ ...form, specialtyId: event.target.value })}>
                    <option value="">Chưa rõ / chọn sau</option>
                    {specialties.map((item) => <option key={item.specialtyId} value={item.specialtyId}>{item.name}</option>)}
                  </select>
                </label>
                <label className="field full"><span>Nội dung <i>*</i></span><textarea required rows="6" minLength="5" maxLength="2000" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Mô tả triệu chứng, thời gian bắt đầu, điều bạn muốn hỏi..." /></label>
              </div>
              <button className="button button-primary submit-button" type="submit" disabled={busy}>{busy ? "Đang gửi..." : "Gửi yêu cầu tư vấn"} <span>→</span></button>
              <p className="form-footnote">Không gửi mật khẩu hoặc thông tin thanh toán trong nội dung tư vấn.</p>
            </form>
          )}

          {!composing && !selectedId && (
            <div className="no-appointments"><div className="empty-calendar">✉</div><h2>Chọn một cuộc tư vấn</h2><p>Hoặc bấm “Câu hỏi mới” để gửi yêu cầu đến phòng khám.</p></div>
          )}

          {!composing && selectedId && !detail && <p className="empty-state">Đang tải cuộc tư vấn...</p>}

          {!composing && detail && (
            <>
              <div className="consult-head">
                <div>
                  <h3>{detail.consultation.subject}</h3>
                  <small>{detail.consultation.specialty ? `${detail.consultation.specialty} · ` : ""}{consultationStatus[detail.consultation.status]}</small>
                </div>
                {detail.consultation.status !== "closed" && <button className="cancel-button" disabled={busy} onClick={closeThread}>Kết thúc tư vấn</button>}
              </div>
              <ChatThread messages={detail.messages} ownType="patient" />
              {detail.consultation.status === "closed" ? (
                <p className="form-footnote">Cuộc tư vấn đã kết thúc. Hãy gửi câu hỏi mới nếu bạn cần hỏi thêm.</p>
              ) : (
                <form className="chat-form" onSubmit={sendReply}>
                  <textarea rows="2" maxLength="2000" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Nhập tin nhắn..." />
                  <button className="button button-primary button-small" type="submit" disabled={busy || !reply.trim()}>Gửi</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default Consultation;
