import { useCallback, useEffect, useState } from "react";
import { ChatThread, consultationStatus, usePolling } from "./Consultation.jsx";
import { dateTime, formatDateTime, money, request, statusLabels, today } from "./api.js";

const dayNames = { 1: "Chủ nhật", 2: "Thứ hai", 3: "Thứ ba", 4: "Thứ tư", 5: "Thứ năm", 6: "Thứ sáu", 7: "Thứ bảy" };
const dayOrder = [2, 3, 4, 5, 6, 7, 1];

// ---------------------------------------------------------------- Lịch hẹn
function StaffAppointments({ onChanged }) {
  const [filters, setFilters] = useState({ status: "pending", date: "", doctorId: "" });
  const [doctors, setDoctors] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    query.set("status", filters.status);
    if (filters.date) query.set("date", filters.date);
    if (filters.doctorId) query.set("doctorId", filters.doctorId);
    try {
      setItems(await request(`/api/staff/appointments?${query}`));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    request("/api/staff/doctors").then(setDoctors).catch(() => {});
  }, []);

  usePolling(load, 20000, true);

  async function act(item, status, note) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/api/staff/appointments/${item.appointmentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, note }),
      });
      setNotice(`Lịch #${item.appointmentId} đã chuyển sang "${statusLabels[status]}".`);
      setReasonFor(null);
      setReason("");
      await load();
      onChanged();
    } catch (actionError) {
      setError(actionError.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="staff-filters">
        <label className="field"><span>Trạng thái</span>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="pending">Chờ xác nhận</option>
            <option value="confirmed">Đã xác nhận</option>
            <option value="completed">Đã hoàn thành</option>
            <option value="cancelled">Đã hủy / từ chối</option>
            <option value="no_show">Không đến</option>
            <option value="all">Tất cả</option>
          </select>
        </label>
        <label className="field"><span>Ngày khám</span><input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} /></label>
        <label className="field"><span>Bác sĩ</span>
          <select value={filters.doctorId} onChange={(event) => setFilters({ ...filters, doctorId: event.target.value })}>
            <option value="">Tất cả bác sĩ</option>
            {doctors.map((doctor) => <option key={doctor.doctorId} value={doctor.doctorId}>{doctor.fullName}</option>)}
          </select>
        </label>
        <button className="button button-outline button-small" onClick={() => setFilters({ status: "pending", date: "", doctorId: "" })}>Đặt lại</button>
      </div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {loading ? <p className="empty-state">Đang tải lịch hẹn...</p> : items.length === 0 ? (
        <div className="no-appointments"><div className="empty-calendar">▦</div><h2>Không có lịch hẹn phù hợp</h2><p>Thử đổi bộ lọc trạng thái, ngày hoặc bác sĩ.</p></div>
      ) : (
        <div className="appointments-list">
          {items.map((item) => {
            const past = dateTime(item.startAt) <= new Date();
            const askingReason = reasonFor === item.appointmentId;
            return (
              <article className="appointment-card staff-card" key={item.appointmentId}>
                <div className="appointment-date"><span>{dateTime(item.startAt).toLocaleDateString("vi-VN", { day: "2-digit" })}</span><small>{dateTime(item.startAt).toLocaleDateString("vi-VN", { month: "short", year: "numeric" })}</small></div>
                <div className="appointment-main">
                  <div className="appointment-title"><h3>{item.serviceName}</h3><span className={`status status-${item.status}`}>{statusLabels[item.status]}</span>{past && ["pending", "confirmed"].includes(item.status) && <span className="status status-late">Đã qua giờ hẹn</span>}</div>
                  <p>{item.specialty} <span>·</span> {item.doctorName} <span>·</span> {dateTime(item.startAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}–{dateTime(item.endAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</p>
                  <div className="patient-line"><b>{item.patientName}</b><span>{item.patientPhone}</span>{item.patientEmail && <span>{item.patientEmail}</span>}</div>
                  {item.patientNote && <p className="note-line">Bệnh nhân ghi chú: {item.patientNote}</p>}
                  {item.staffNote && <p className="note-line staff">Phòng khám: {item.staffNote}{item.handledBy ? ` (${item.handledBy})` : ""}</p>}
                  <div className="appointment-details"><span>⌑ Mã lịch #{item.appointmentId}</span><b>{money.format(Number(item.price))}</b></div>
                  {askingReason && (
                    <form className="reason-form" onSubmit={(event) => { event.preventDefault(); act(item, "cancelled", reason); }}>
                      <input autoFocus required minLength="3" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Lý do gửi cho bệnh nhân (bắt buộc)" />
                      <button className="cancel-button" type="submit" disabled={busy}>Xác nhận hủy lịch</button>
                      <button className="button-text-small" type="button" onClick={() => { setReasonFor(null); setReason(""); }}>Bỏ qua</button>
                    </form>
                  )}
                </div>
                <div className="staff-actions">
                  {item.status === "pending" && !past && <button className="button button-primary button-small" disabled={busy} onClick={() => act(item, "confirmed")}>Xác nhận</button>}
                  {item.status === "confirmed" && past && <button className="button button-primary button-small" disabled={busy} onClick={() => act(item, "completed")}>Hoàn thành</button>}
                  {item.status === "confirmed" && past && <button className="button button-outline button-small" disabled={busy} onClick={() => act(item, "no_show")}>Không đến</button>}
                  {["pending", "confirmed"].includes(item.status) && !askingReason && <button className="cancel-button" disabled={busy} onClick={() => { setReasonFor(item.appointmentId); setReason(""); }}>{item.status === "pending" ? "Từ chối" : "Hủy lịch"}</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Tư vấn
function StaffConsultations({ onChanged }) {
  const [status, setStatus] = useState("open");
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    try {
      setList(await request(`/api/staff/consultations?status=${status}`));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  const loadDetail = useCallback(async (id) => {
    try {
      setDetail(await request(`/api/staff/consultations/${id}`));
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadList();
  }, [loadList]);

  useEffect(() => {
    setDetail(null);
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  usePolling(() => {
    loadList();
    if (selectedId) loadDetail(selectedId);
  }, 8000, true);

  async function send(event) {
    event.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/staff/consultations/${selectedId}/messages`, { method: "POST", body: JSON.stringify({ body: reply }) });
      setReply("");
      await Promise.all([loadDetail(selectedId), loadList()]);
      onChanged();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!window.confirm("Kết thúc cuộc tư vấn này? Cả hai bên sẽ không nhắn thêm được.")) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/staff/consultations/${selectedId}/close`, { method: "PATCH" });
      await Promise.all([loadDetail(selectedId), loadList()]);
      onChanged();
    } catch (closeError) {
      setError(closeError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="staff-filters">
        <label className="field"><span>Trạng thái</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setSelectedId(null); }}>
            <option value="open">Chờ phản hồi</option>
            <option value="answered">Đã phản hồi</option>
            <option value="closed">Đã kết thúc</option>
            <option value="all">Tất cả</option>
          </select>
        </label>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="consult-layout">
        <aside className="consult-list">
          {loading ? <p className="empty-state">Đang tải...</p> : list.length === 0 ? <p className="empty-state">Không có cuộc tư vấn nào.</p> : list.map((item) => (
            <button key={item.consultationId} className={item.consultationId === selectedId ? "consult-item active" : "consult-item"} onClick={() => { setError(""); setSelectedId(item.consultationId); }}>
              <span className="consult-item-top"><b>{item.subject}</b><span className={`status consult-${item.status}`}>{consultationStatus[item.status]}</span></span>
              <small>{item.patientName} · {item.patientPhone}{item.specialty ? ` · ${item.specialty}` : ""}</small>
              <span className="consult-snippet">{item.lastMessage}</span>
              <small>{formatDateTime(item.updatedAt)}</small>
            </button>
          ))}
        </aside>
        <div className="consult-panel">
          {!selectedId && <div className="no-appointments"><div className="empty-calendar">✉</div><h2>Chọn một cuộc tư vấn</h2><p>Các yêu cầu chờ phản hồi lâu nhất được xếp lên đầu.</p></div>}
          {selectedId && !detail && <p className="empty-state">Đang tải...</p>}
          {detail && (
            <>
              <div className="consult-head">
                <div><h3>{detail.consultation.subject}</h3><small>{detail.consultation.patientName} · {detail.consultation.patientPhone}{detail.consultation.patientEmail ? ` · ${detail.consultation.patientEmail}` : ""}{detail.consultation.specialty ? ` · ${detail.consultation.specialty}` : ""}</small></div>
                {detail.consultation.status !== "closed" && <button className="cancel-button" disabled={busy} onClick={close}>Kết thúc</button>}
              </div>
              <ChatThread messages={detail.messages} ownType="staff" />
              {detail.consultation.status === "closed" ? <p className="form-footnote">Cuộc tư vấn đã kết thúc.</p> : (
                <form className="chat-form" onSubmit={send}>
                  <textarea rows="3" maxLength="2000" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Nhập phản hồi cho bệnh nhân..." />
                  <button className="button button-primary button-small" type="submit" disabled={busy || !reply.trim()}>Gửi phản hồi</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Ca làm
function SlotRow({ slot, busy, onSave, onToggle, onDelete }) {
  const [start, setStart] = useState(slot.startTime);
  const [end, setEnd] = useState(slot.endTime);
  useEffect(() => {
    setStart(slot.startTime);
    setEnd(slot.endTime);
  }, [slot.startTime, slot.endTime]);
  const changed = start !== slot.startTime || end !== slot.endTime;
  return (
    <div className={slot.isActive ? "slot-row" : "slot-row off"}>
      <input type="time" value={start} onChange={(event) => setStart(event.target.value)} aria-label="Giờ bắt đầu" />
      <span>→</span>
      <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} aria-label="Giờ kết thúc" />
      {changed && <button className="button button-primary button-small" disabled={busy} onClick={() => onSave(slot, start, end)}>Lưu</button>}
      <button className="button button-outline button-small" disabled={busy} onClick={() => onToggle(slot)}>{slot.isActive ? "Tắt ca" : "Bật ca"}</button>
      <button className="cancel-button" disabled={busy} onClick={() => onDelete(slot)}>Xóa</button>
    </div>
  );
}

function StaffSchedules() {
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState("");
  const [data, setData] = useState(null);
  const [slotForm, setSlotForm] = useState({ dayOfWeek: "2", startTime: "08:00", endTime: "17:00" });
  const [offForm, setOffForm] = useState({ offDate: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    request("/api/staff/doctors")
      .then((rows) => {
        setDoctors(rows);
        if (rows[0]) setDoctorId(String(rows[0].doctorId));
      })
      .catch((loadError) => setError(loadError.message));
  }, []);

  const load = useCallback(async () => {
    if (!doctorId) return;
    try {
      setData(await request(`/api/staff/doctors/${doctorId}/schedule`));
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [doctorId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  async function run(action, success) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      const warnings = [];
      if (result?.uncoveredAppointments > 0) warnings.push(`${result.uncoveredAppointments} lịch sắp tới của bác sĩ nằm ngoài ca làm — hãy xử lý trong mục Lịch hẹn.`);
      if (result?.affectedAppointments > 0) warnings.push(`Có ${result.affectedAppointments} lịch hẹn trong ngày này cần liên hệ/hủy trong mục Lịch hẹn.`);
      setNotice([success, ...warnings].join(" "));
      await load();
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const addSlot = (event) => {
    event.preventDefault();
    run(() => request(`/api/staff/doctors/${doctorId}/schedules`, { method: "POST", body: JSON.stringify(slotForm) }), "Đã thêm ca làm.");
  };
  const saveSlot = (slot, startTime, endTime) =>
    run(() => request(`/api/staff/schedules/${slot.scheduleId}`, { method: "PATCH", body: JSON.stringify({ startTime, endTime }) }), "Đã cập nhật giờ làm.");
  const toggleSlot = (slot) =>
    run(() => request(`/api/staff/schedules/${slot.scheduleId}`, { method: "PATCH", body: JSON.stringify({ isActive: !slot.isActive }) }), slot.isActive ? "Đã tắt ca làm." : "Đã bật lại ca làm.");
  const deleteSlot = (slot) => {
    if (!window.confirm(`Xóa ca ${dayNames[slot.dayOfWeek]} ${slot.startTime}–${slot.endTime}?`)) return;
    run(() => request(`/api/staff/schedules/${slot.scheduleId}`, { method: "DELETE" }), "Đã xóa ca làm.");
  };
  const addOff = async (event) => {
    event.preventDefault();
    const ok = await run(() => request(`/api/staff/doctors/${doctorId}/days-off`, { method: "POST", body: JSON.stringify(offForm) }), "Đã thêm ngày nghỉ.");
    if (ok) setOffForm({ offDate: "", reason: "" });
  };
  const deleteOff = (off) => {
    if (!window.confirm(`Bỏ ngày nghỉ ${dateTime(off.offDate).toLocaleDateString("vi-VN")}?`)) return;
    run(async () => { await request(`/api/staff/days-off/${off.dayOffId}`, { method: "DELETE" }); return null; }, "Đã bỏ ngày nghỉ.");
  };

  return (
    <div>
      <div className="staff-filters">
        <label className="field"><span>Bác sĩ</span>
          <select value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setNotice(""); setError(""); }}>
            {doctors.map((doctor) => <option key={doctor.doctorId} value={doctor.doctorId}>{doctor.fullName} · {doctor.specialty}</option>)}
          </select>
        </label>
      </div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {data?.uncoveredAppointments > 0 && <div className="alert warn" role="status">Hiện có {data.uncoveredAppointments} lịch sắp tới nằm ngoài ca làm của bác sĩ này.</div>}
      {!data ? <p className="empty-state">Đang tải lịch làm việc...</p> : (
        <div className="schedule-grid">
          <div className="schedule-card">
            <h3>Ca làm theo tuần</h3>
            <p className="muted">Bệnh nhân chỉ đặt được trong các ca đang bật. Ca đã có lịch hẹn không bị tự động hủy.</p>
            {dayOrder.map((day) => {
              const slots = data.schedules.filter((slot) => slot.dayOfWeek === day);
              return (
                <div className="day-block" key={day}>
                  <b>{dayNames[day]}</b>
                  {slots.length === 0 ? <span className="muted">Nghỉ</span> : <div>{slots.map((slot) => <SlotRow key={slot.scheduleId} slot={slot} busy={busy} onSave={saveSlot} onToggle={toggleSlot} onDelete={deleteSlot} />)}</div>}
                </div>
              );
            })}
            <form className="add-form" onSubmit={addSlot}>
              <select value={slotForm.dayOfWeek} onChange={(event) => setSlotForm({ ...slotForm, dayOfWeek: event.target.value })} aria-label="Thứ">
                {dayOrder.map((day) => <option key={day} value={day}>{dayNames[day]}</option>)}
              </select>
              <input required type="time" value={slotForm.startTime} onChange={(event) => setSlotForm({ ...slotForm, startTime: event.target.value })} aria-label="Giờ bắt đầu" />
              <span>→</span>
              <input required type="time" value={slotForm.endTime} onChange={(event) => setSlotForm({ ...slotForm, endTime: event.target.value })} aria-label="Giờ kết thúc" />
              <button className="button button-primary button-small" type="submit" disabled={busy}>+ Thêm ca</button>
            </form>
          </div>
          <div className="schedule-card">
            <h3>Ngày nghỉ sắp tới</h3>
            <p className="muted">Ngày nghỉ chặn mọi lịch đặt mới trong ngày đó.</p>
            {data.daysOff.length === 0 ? <p className="muted">Chưa có ngày nghỉ nào.</p> : data.daysOff.map((off) => (
              <div className="off-row" key={off.dayOffId}>
                <b>{dateTime(off.offDate).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</b>
                <span>{off.reason || "Không ghi lý do"}</span>
                <button className="cancel-button" disabled={busy} onClick={() => deleteOff(off)}>Bỏ</button>
              </div>
            ))}
            <form className="add-form" onSubmit={addOff}>
              <input required type="date" min={today()} value={offForm.offDate} onChange={(event) => setOffForm({ ...offForm, offDate: event.target.value })} aria-label="Ngày nghỉ" />
              <input maxLength="255" value={offForm.reason} onChange={(event) => setOffForm({ ...offForm, reason: event.target.value })} placeholder="Lý do (không bắt buộc)" aria-label="Lý do nghỉ" />
              <button className="button button-primary button-small" type="submit" disabled={busy}>+ Thêm ngày nghỉ</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Khung chính
function Staff({ onExit }) {
  const [staff, setStaff] = useState(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("appointments");
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(() => {
    request("/api/staff/summary").then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    request("/api/staff/auth/me")
      .then((result) => setStaff(result.staff))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (staff) loadSummary();
  }, [staff, loadSummary]);

  usePolling(loadSummary, 15000, Boolean(staff));

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/staff/auth/login", { method: "POST", body: JSON.stringify(form) });
      setStaff(result.staff);
      setForm({ email: "", password: "" });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await request("/api/staff/auth/logout", { method: "POST" });
    } catch {
      // vẫn thoát giao diện nếu phiên đã hết hạn
    }
    setStaff(null);
    setSummary(null);
    setBusy(false);
  }

  if (checking) return <div className="site staff-site"><p className="empty-state staff-loading">Đang kiểm tra phiên đăng nhập...</p></div>;

  if (!staff) {
    return (
      <div className="site staff-site">
        <section className="staff-login">
          <div className="auth-card">
            <div className="auth-heading"><span className="eyebrow">KHU VỰC NHÂN VIÊN PHÒNG KHÁM</span><h2>Đăng nhập nhân viên</h2><p>Tài khoản nhân viên do quản trị tạo riêng, không dùng chung với tài khoản bệnh nhân.</p></div>
            <form onSubmit={login}>
              <label className="field"><span>Email</span><input required type="email" autoComplete="username" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
              <label className="field"><span>Mật khẩu</span><input required type="password" autoComplete="current-password" maxLength="72" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
              {error && <div className="alert error" role="alert">{error}</div>}
              <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Đang xử lý..." : "Đăng nhập"} <span>→</span></button>
            </form>
            <p className="auth-switch"><button onClick={onExit}>← Về trang bệnh nhân</button></p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="site staff-site">
      <header className="site-header">
        <span className="brand"><span className="brand-symbol"><span>+</span></span><span className="brand-name">An tâm<small>KHU VỰC NHÂN VIÊN</small></span></span>
        <nav className="main-nav" aria-label="Điều hướng nhân viên">
          <button className={tab === "appointments" ? "nav-item selected" : "nav-item"} onClick={() => setTab("appointments")}>Lịch hẹn{summary?.pendingAppointments > 0 && <span className="badge">{summary.pendingAppointments}</span>}</button>
          <button className={tab === "consultations" ? "nav-item selected" : "nav-item"} onClick={() => setTab("consultations")}>Tư vấn{summary?.openConsultations > 0 && <span className="badge">{summary.openConsultations}</span>}</button>
          <button className={tab === "schedules" ? "nav-item selected" : "nav-item"} onClick={() => setTab("schedules")}>Lịch bác sĩ</button>
        </nav>
        <div className="header-account">
          <span className="account-chip"><span className="avatar">{staff.fullName.slice(0, 1).toUpperCase()}</span><span className="account-name">{staff.fullName}</span></span>
          <button className="button button-outline button-small" disabled={busy} onClick={logout}>Đăng xuất</button>
        </div>
      </header>
      <main>
        <section className="account-section staff-section">
          <div className="account-heading">
            <div>
              <span className="eyebrow">QUẢN LÝ PHÒNG KHÁM</span>
              <h1>{tab === "appointments" ? "Lịch hẹn" : tab === "consultations" ? "Tư vấn trực tuyến" : "Ca làm & ngày nghỉ của bác sĩ"}</h1>
              {summary && <p>{summary.pendingAppointments} lịch chờ xác nhận · {summary.todayAppointments} lịch hôm nay · {summary.openConsultations} tư vấn chờ phản hồi</p>}
            </div>
            <button className="inline-link" onClick={onExit}>Về trang bệnh nhân →</button>
          </div>
          {tab === "appointments" && <StaffAppointments onChanged={loadSummary} />}
          {tab === "consultations" && <StaffConsultations onChanged={loadSummary} />}
          {tab === "schedules" && <StaffSchedules />}
        </section>
      </main>
    </div>
  );
}

export default Staff;
