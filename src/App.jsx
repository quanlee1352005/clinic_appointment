import { useEffect, useMemo, useState } from "react";

import Consultation from "./Consultation.jsx";
import Staff from "./Staff.jsx";
import { dateTime, money, request, statusLabels, today } from "./api.js";

function App() {
  const [user, setUser] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [page, setPage] = useState("home");
  const [authMode, setAuthMode] = useState("login");
  const [afterAuth, setAfterAuth] = useState("appointments");
  const [staffMode, setStaffMode] = useState(window.location.hash === "#staff");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("upcoming");
  const [authForm, setAuthForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
  });
  const [booking, setBooking] = useState({
    serviceId: "",
    doctorId: "",
    startAt: "",
    note: "",
  });

  useEffect(() => {
    Promise.all([
      request("/api/catalog")
        .then(setCatalog)
        .catch((loadError) => setError(loadError.message)),
      request("/api/auth/me")
        .then((session) => setUser(session.user))
        .catch((authError) => {
          if (authError.status !== 401) setError(authError.message);
        }),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onHashChange = () => setStaffMode(window.location.hash === "#staff");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!user || page !== "appointments") return;
    setError("");
    request("/api/appointments")
      .then(setAppointments)
      .catch((loadError) => setError(loadError.message));
  }, [user, page]);

  const serviceOptions = useMemo(
    () => [...new Map(catalog.map((item) => [item.serviceId, item])).values()],
    [catalog],
  );
  const availableDoctors = useMemo(
    () => catalog.filter((item) => String(item.serviceId) === booking.serviceId),
    [catalog, booking.serviceId],
  );
  const selectedOption = catalog.find(
    (item) =>
      String(item.serviceId) === booking.serviceId &&
      String(item.doctorId) === booking.doctorId,
  );
  const visibleAppointments = appointments.filter((item) => {
    if (filter === "upcoming") {
      return ["pending", "confirmed"].includes(item.status) && dateTime(item.startAt) >= new Date();
    }
    if (filter === "history") {
      return !["pending", "confirmed"].includes(item.status) || dateTime(item.startAt) < new Date();
    }
    return true;
  });

  function openAuth(mode, destination = "appointments") {
    setError("");
    setNotice("");
    setAuthMode(mode);
    setAfterAuth(destination);
    setPage("auth");
  }

  function openBooking(serviceId = "") {
    setError("");
    setNotice("");
    setBooking({ serviceId: String(serviceId || ""), doctorId: "", startAt: "", note: "" });
    if (!user) return openAuth("login", "booking");
    setPage("booking");
  }

  function openConsult() {
    setError("");
    setNotice("");
    if (!user) return openAuth("login", "consult");
    setPage("consult");
  }

  function leaveStaff() {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setStaffMode(false);
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const isRegister = authMode === "register";
      const result = await request(`/api/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(authForm),
      });
      setUser(result.user);
      setPage(afterAuth);
      setNotice(isRegister ? "Tài khoản đã được tạo. Chào mừng bạn đến An Tâm!" : "Đăng nhập thành công.");
      setAuthForm({ fullName: "", phone: "", email: "", password: "" });
    } catch (authError) {
      setError(authError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await request("/api/auth/logout", { method: "POST" });
      setUser(null);
      setAppointments([]);
      setPage("home");
      setNotice("Bạn đã đăng xuất.");
      setError("");
    } catch (logoutError) {
      setError(logoutError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitBooking(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request("/api/appointments", {
        method: "POST",
        body: JSON.stringify(booking),
      });
      setNotice(`Đã gửi yêu cầu đặt lịch #${result.appointmentId}. Phòng khám sẽ xác nhận với bạn.`);
      setBooking((current) => ({ ...current, startAt: "", note: "" }));
      setPage("appointments");
      const nextAppointments = await request("/api/appointments");
      setAppointments(nextAppointments);
    } catch (bookingError) {
      setError(bookingError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelAppointment(appointmentId) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/api/appointments/${appointmentId}/cancel`, { method: "PATCH" });
      setAppointments(await request("/api/appointments"));
      setNotice("Lịch hẹn đã được hủy.");
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setBusy(false);
    }
  }

  if (staffMode) return <Staff onExit={leaveStaff} />;

  return (
    <div className="site">
      <header className="site-header">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage("home"); }}>
          <span className="brand-symbol"><span>+</span></span>
          <span className="brand-name">An tâm<small>PHÒNG KHÁM ĐA KHOA</small></span>
        </a>
        <nav className="main-nav" aria-label="Điều hướng chính">
          <button className={page === "home" ? "nav-item selected" : "nav-item"} onClick={() => setPage("home")}>Trang chủ</button>
          <a className="nav-item" href="#services" onClick={() => setPage("home")}>Dịch vụ</a>
          <button className={page === "consult" ? "nav-item selected" : "nav-item"} onClick={openConsult}>Tư vấn trực tuyến</button>
          {user && <button className={page === "appointments" ? "nav-item selected" : "nav-item"} onClick={() => setPage("appointments")}>Lịch hẹn của tôi</button>}
        </nav>
        <div className="header-account">
          {user ? (
            <>
              <button className="account-chip" onClick={() => setPage("appointments")}><span className="avatar">{user.fullName.slice(0, 1).toUpperCase()}</span><span className="account-name">{user.fullName}</span></button>
              <button className="button button-outline button-small" disabled={busy} onClick={logout}>Đăng xuất</button>
            </>
          ) : (
            <>
              <button className="button button-text" onClick={() => openAuth("login")}>Đăng nhập</button>
              <button className="button button-primary button-small" onClick={() => openAuth("register")}>Tạo tài khoản</button>
            </>
          )}
        </div>
      </header>

      <main>
        {page === "home" && (
          <>
            <section className="hero">
              <div className="hero-content">
                <div className="hero-kicker"><span /> CHĂM SÓC SỨC KHỎE, BẮT ĐẦU TỪ AN TÂM</div>
                <h1>Chăm sóc bạn<br />bằng sự <em>tận tâm.</em></h1>
                <p>Đội ngũ bác sĩ đồng hành cùng bạn trên hành trình chăm sóc sức khỏe — chu đáo từ lần hẹn đầu tiên.</p>
                <div className="hero-actions">
                  <button className="button button-primary" onClick={() => openBooking()}>Đặt lịch khám <span>→</span></button>
                  <a className="hero-link" href="#services">Tìm hiểu dịch vụ <span>↓</span></a>
                </div>
                <div className="hero-assurance"><span>✓</span> Thông tin lịch khám được lưu riêng trong tài khoản của bạn</div>
              </div>
              <div className="hero-visual" aria-hidden="true">
                <div className="visual-circle circle-back" />
                <div className="visual-circle circle-front" />
                <div className="visual-plus">+</div>
                <div className="visual-doctor"><div className="doctor-head" /><div className="doctor-body"><span>✚</span></div></div>
                <div className="visual-note"><span className="note-icon">✓</span><span><b>Đặt lịch thật dễ dàng</b><small>Chăm sóc đúng lúc bạn cần</small></span></div>
                <div className="visual-flower flower-a">✿</div><div className="visual-flower flower-b">✿</div>
              </div>
              <div className="hero-bottom"><span>01 / 03</span><span className="hero-line" /><span>ĐỒNG HÀNH CÙNG SỨC KHỎE CỦA BẠN</span></div>
            </section>

            <section className="value-strip">
              <div><span className="value-icon">✳</span><span><b>Bác sĩ tận tâm</b><small>Lắng nghe và tư vấn chu đáo</small></span></div>
              <div><span className="value-icon">◷</span><span><b>Đặt lịch linh hoạt</b><small>Chọn thời gian phù hợp với bạn</small></span></div>
              <div><span className="value-icon">♡</span><span><b>Riêng tư an toàn</b><small>Lịch hẹn gắn với tài khoản cá nhân</small></span></div>
            </section>

            <section className="services-section" id="services">
              <div className="section-topline"><span className="eyebrow">CHĂM SÓC TOÀN DIỆN</span><span className="section-index">01 — DỊCH VỤ</span></div>
              <div className="section-title-row"><div><h2>Dịch vụ dành cho bạn</h2><p>Tìm dịch vụ phù hợp và đặt lịch với bác sĩ của chúng tôi.</p></div><button className="inline-link" onClick={() => openBooking()}>Đặt lịch ngay <span>→</span></button></div>
              {error && <div className="alert error" role="alert">{error}</div>}
              {loading ? <p className="empty-state">Đang tải danh sách dịch vụ...</p> : serviceOptions.length === 0 ? (
                <p className="empty-state">Chưa có dịch vụ hiển thị.</p>
              ) : (
                <div className="service-grid">
                  {serviceOptions.map((service, index) => {
                    const doctors = catalog.filter((item) => item.serviceId === service.serviceId);
                    return (
                      <article className="service-card" key={service.serviceId}>
                        <div className={`service-card-icon icon-${index % 3}`}>{["✚", "◉", "✳"][index % 3]}</div>
                        <span className="service-number">0{index + 1}</span>
                        <h3>{service.serviceName}</h3>
                        <p>{service.serviceDescription || "Dịch vụ thăm khám và tư vấn sức khỏe cùng bác sĩ chuyên khoa."}</p>
                        <div className="service-meta"><span>{doctors[0]?.specialty}</span><span>{service.durationMinutes} phút</span></div>
                        <div className="service-footer"><b>{money.format(Number(service.price))}<small> / lượt khám</small></b><button aria-label={`Đặt lịch ${service.serviceName}`} onClick={() => openBooking(service.serviceId)}>↗</button></div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="consult-promo">
              <div><span className="eyebrow">TƯ VẤN TRỰC TUYẾN</span><h2>Có thắc mắc? Hỏi trực tiếp phòng khám.</h2><p>Gửi câu hỏi và nhận phản hồi từ nhân viên phòng khám — do người thật trả lời, không dùng AI.</p></div>
              <button className="button button-outline" onClick={openConsult}>Gửi câu hỏi <span>→</span></button>
            </section>

            <section className="closing-cta">
              <div><span className="eyebrow">BẠN ĐÃ SẴN SÀNG?</span><h2>Bắt đầu chăm sóc sức khỏe<br />từ một cuộc hẹn.</h2></div>
              <button className="button button-light" onClick={() => openBooking()}>Đặt lịch khám <span>→</span></button>
            </section>
          </>
        )}

        {page === "auth" && (
          <section className="auth-layout">
            <div className="auth-story">
              <span className="eyebrow">AN TÂM — ĐỒNG HÀNH CÙNG BẠN</span>
              <h1>Một tài khoản.<br /><em>Mọi lịch hẹn.</em></h1>
              <p>Đăng nhập để đặt lịch và xem riêng lịch thăm khám của bạn, bất cứ khi nào cần.</p>
              <div className="auth-benefit"><span>✓</span><div><b>Lịch hẹn riêng tư</b><small>Chỉ bạn mới xem được lịch của mình</small></div></div>
              <div className="auth-benefit"><span>✓</span><div><b>Quản lý thuận tiện</b><small>Theo dõi và hủy lịch trực tiếp trên tài khoản</small></div></div>
              <div className="auth-decoration">✳</div>
            </div>
            <div className="auth-card">
              <div className="auth-tabs">
                <button className={authMode === "login" ? "auth-tab active" : "auth-tab"} onClick={() => { setAuthMode("login"); setError(""); }}>Đăng nhập</button>
                <button className={authMode === "register" ? "auth-tab active" : "auth-tab"} onClick={() => { setAuthMode("register"); setError(""); }}>Tạo tài khoản</button>
              </div>
              <div className="auth-heading"><span className="eyebrow">{authMode === "login" ? "CHÀO MỪNG BẠN QUAY LẠI" : "BẮT ĐẦU HÀNH TRÌNH AN TÂM"}</span><h2>{authMode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h2><p>{authMode === "login" ? "Nhập thông tin tài khoản của bạn." : "Tạo tài khoản để lưu lịch hẹn riêng của bạn."}</p></div>
              <form onSubmit={submitAuth}>
                {authMode === "register" && (
                  <>
                    <label className="field"><span>Họ và tên</span><input required minLength="2" maxLength="160" autoComplete="name" value={authForm.fullName} onChange={(event) => setAuthForm({ ...authForm, fullName: event.target.value })} placeholder="Nguyễn Văn An" /></label>
                    <label className="field"><span>Số điện thoại</span><input required minLength="8" maxLength="20" autoComplete="tel" value={authForm.phone} onChange={(event) => setAuthForm({ ...authForm, phone: event.target.value })} placeholder="09xx xxx xxx" /></label>
                  </>
                )}
                <label className="field"><span>Email</span><input required type="email" maxLength="254" autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="email@example.com" /></label>
                <label className="field"><span>Mật khẩu</span><input required type="password" minLength={authMode === "register" ? 10 : 1} maxLength="72" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder={authMode === "register" ? "Ít nhất 10 ký tự" : "Nhập mật khẩu"} /></label>
                {error && <div className="alert error" role="alert">{error}</div>}
                <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Đang xử lý..." : authMode === "login" ? "Đăng nhập" : "Tạo tài khoản"} <span>→</span></button>
              </form>
              <p className="auth-switch">{authMode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"} <button onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setError(""); }}>{authMode === "login" ? "Đăng ký miễn phí" : "Đăng nhập"}</button></p>
              <p className="privacy-note">Mật khẩu được mã hóa trước khi lưu. Không chia sẻ mật khẩu với người khác.</p>
            </div>
          </section>
        )}

        {page === "booking" && user && (
          <section className="account-section">
            <div className="account-heading"><div><span className="eyebrow">ĐẶT LỊCH TRỰC TUYẾN</span><h1>Chọn lịch thăm khám</h1><p>Thông tin liên hệ được lấy từ tài khoản của bạn.</p></div><button className="inline-link" onClick={() => setPage("appointments")}>Lịch hẹn của tôi →</button></div>
            {error && <div className="alert error" role="alert">{error}</div>}
            {notice && <div className="alert success" role="status">{notice}</div>}
            <div className="booking-layout">
              <form className="booking-card" onSubmit={submitBooking}>
                <div className="form-title"><span className="step-number">01</span><div><h3>Thông tin thăm khám</h3><p>Chọn dịch vụ, bác sĩ và thời gian phù hợp</p></div></div>
                <div className="form-grid">
                  <label className="field full"><span>Dịch vụ khám <i>*</i></span><select required value={booking.serviceId} onChange={(event) => setBooking({ ...booking, serviceId: event.target.value, doctorId: "" })}><option value="">Chọn dịch vụ</option>{serviceOptions.map((item) => <option key={item.serviceId} value={item.serviceId}>{item.serviceName}</option>)}</select></label>
                  <label className="field"><span>Bác sĩ <i>*</i></span><select required disabled={!booking.serviceId} value={booking.doctorId} onChange={(event) => setBooking({ ...booking, doctorId: event.target.value })}><option value="">Chọn bác sĩ</option>{availableDoctors.map((item) => <option key={item.doctorId} value={item.doctorId}>{item.doctorName} · {item.specialty}</option>)}</select></label>
                  <label className="field"><span>Ngày và giờ <i>*</i></span><input required type="datetime-local" min={`${today()}T00:00`} value={booking.startAt} onChange={(event) => setBooking({ ...booking, startAt: event.target.value })} /></label>
                  <label className="field full"><span>Ghi chú <small>(không bắt buộc)</small></span><textarea rows="4" maxLength="1000" value={booking.note} onChange={(event) => setBooking({ ...booking, note: event.target.value })} placeholder="Thông tin bạn muốn bác sĩ biết trước..." /></label>
                </div>
                <div className="account-preview"><span className="avatar">{user.fullName.slice(0, 1).toUpperCase()}</span><div><b>{user.fullName}</b><small>{user.email} · {user.phone}</small></div><span className="verified">✓ Tài khoản</span></div>
                <button className="button button-primary submit-button" type="submit" disabled={busy || loading || catalog.length === 0}>{busy ? "Đang gửi yêu cầu..." : "Gửi yêu cầu đặt lịch"} <span>→</span></button>
                <p className="form-footnote">Lịch ở trạng thái chờ cho đến khi phòng khám xác nhận.</p>
              </form>
              <aside className="summary-column">
                <div className="summary-card"><span className="eyebrow">TÓM TẮT</span><h3>Thông tin dịch vụ</h3>{selectedOption ? <><div className="summary-service"><span className="service-icon">✚</span><div><b>{selectedOption.serviceName}</b><small>{selectedOption.durationMinutes} phút · {selectedOption.specialty}</small></div></div><div className="summary-line"><span>Bác sĩ</span><b>{selectedOption.doctorName}</b></div><div className="summary-line"><span>Chi phí dự kiến</span><b className="price">{money.format(Number(selectedOption.price))}</b></div></> : <p className="summary-empty">Chọn dịch vụ để xem thời lượng, bác sĩ và chi phí dự kiến.</p>}<div className="summary-divider" /><div className="trust-row"><span>✓</span><p>Thanh toán tại phòng khám<br /><small>Không thu phí khi đặt lịch</small></p></div></div>
                <div className="help-card"><span className="help-icon">i</span><div><b>Cần hỗ trợ?</b><p>Gọi cho chúng tôi<br /><strong>1900 1234</strong></p></div></div>
              </aside>
            </div>
          </section>
        )}

        {page === "consult" && user && <Consultation />}

        {page === "appointments" && user && (
          <section className="account-section">
            <div className="account-heading"><div><span className="eyebrow">KHÔNG GIAN CỦA BẠN</span><h1>Lịch hẹn của tôi</h1><p>Xin chào {user.fullName}, các lịch bên dưới chỉ hiển thị trong tài khoản của bạn.</p></div><button className="button button-primary" onClick={() => openBooking()}>+ Đặt lịch mới</button></div>
            {notice && <div className="alert success" role="status">{notice}</div>}
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="appointment-toolbar"><div className="filter-tabs"><button className={filter === "upcoming" ? "filter-tab active" : "filter-tab"} onClick={() => setFilter("upcoming")}>Sắp tới</button><button className={filter === "history" ? "filter-tab active" : "filter-tab"} onClick={() => setFilter("history")}>Lịch sử</button><button className={filter === "all" ? "filter-tab active" : "filter-tab"} onClick={() => setFilter("all")}>Tất cả</button></div><span>{visibleAppointments.length} lịch hẹn</span></div>
            {loading ? <p className="empty-state">Đang tải lịch hẹn...</p> : visibleAppointments.length === 0 ? (
              <div className="no-appointments"><div className="empty-calendar">▦</div><h2>Chưa có lịch hẹn ở đây</h2><p>Khi bạn đặt lịch, thông tin sẽ được lưu riêng trong tài khoản này.</p><button className="button button-primary" onClick={() => openBooking()}>Đặt lịch khám</button></div>
            ) : (
              <div className="appointments-list">
                {visibleAppointments.map((item) => (
                  <article className="appointment-card" key={item.appointmentId}>
                    <div className="appointment-date"><span>{dateTime(item.startAt).toLocaleDateString("vi-VN", { day: "2-digit" })}</span><small>{dateTime(item.startAt).toLocaleDateString("vi-VN", { month: "short", year: "numeric" })}</small></div>
                    <div className="appointment-main"><div className="appointment-title"><h3>{item.serviceName}</h3><span className={`status status-${item.status}`}>{statusLabels[item.status] || item.status}</span></div><p>{item.specialty} <span>·</span> {item.doctorName}</p><div className="appointment-details"><span>◷ {dateTime(item.startAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span><span>⌑ Mã lịch #{item.appointmentId}</span><b>{money.format(Number(item.price))}</b></div>{item.staffNote && <p className="staff-note">Phòng khám: {item.staffNote}</p>}</div>
                    {["pending", "confirmed"].includes(item.status) && dateTime(item.startAt) > new Date() && <button className="cancel-button" disabled={busy} onClick={() => cancelAppointment(item.appointmentId)}>Hủy lịch</button>}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="site-footer"><a className="brand footer-brand" href="#" onClick={(event) => { event.preventDefault(); setPage("home"); }}><span className="brand-symbol"><span>+</span></span><span className="brand-name">an tâm<small>PHÒNG KHÁM ĐA KHOA</small></span></a><span>Chăm sóc tận tâm · Sức khỏe vẹn toàn</span><span>© 2026 An Tâm · <a className="staff-link" href="#staff">Dành cho nhân viên</a></span></footer>
      {notice && !["appointments", "booking", "consult"].includes(page) && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
