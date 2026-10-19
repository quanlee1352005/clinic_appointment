# Hệ thống đặt lịch hẹn dịch vụ thăm khám

Website dùng **React + Vite**, **Node.js + Express** và **MySQL 8.0.16+**.
Bệnh nhân đăng ký/đăng nhập bằng email và mật khẩu, đặt lịch và chỉ xem hoặc
hủy lịch của tài khoản mình.

## Tính năng

- Trang giới thiệu và danh mục dịch vụ/bác sĩ.
- Đăng ký tài khoản bằng email, đăng nhập, đăng xuất; mật khẩu được băm bằng bcrypt.
- Phiên đăng nhập lưu phía máy chủ; cookie `HttpOnly`, `SameSite=Lax`, thời hạn
  7 ngày. Cookie tự bật `Secure` khi chạy với `NODE_ENV=production`.
- Đặt lịch sau khi đăng nhập; máy chủ xác minh giờ làm, ngày nghỉ và xung đột.
- Trang “Lịch hẹn của tôi” chỉ truy vấn theo bệnh nhân gắn với phiên đăng nhập.
- Bệnh nhân chỉ hủy được lịch sắp tới của chính mình; API không cung cấp màn
  hình hoặc thao tác quản trị lịch cho tài khoản bệnh nhân.

## Yêu cầu

- Node.js 20 trở lên
- npm
- MySQL 8.0.16 trở lên

## Cài đặt mới

1. Chạy toàn bộ [clinic_appointment.sql](./clinic_appointment.sql) trong MySQL
   Workbench. Script tạo database, bảng, procedure và dữ liệu dịch vụ mẫu.
2. Sao chép `.env.example` thành `.env`, sau đó cấu hình MySQL:

   ```env
   PORT=3001
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=mat_khau_mysql_cua_ban
   DB_NAME=clinic_appointment
   ```

3. Mở terminal tại thư mục project và chạy:

   ```bash
   npm install
   npm run dev
   ```

4. Mở `http://localhost:5173`, chọn **Tạo tài khoản**. API health check ở
   `http://localhost:3001/api/health`.

## Nâng cấp database đã tạo trước đó

Nếu trước đây đã chạy script SQL cũ, **không cần xóa database hoặc lịch hẹn**.
Chạy một lần [migration 001](./migrations/001_patient_accounts.sql) trong
Workbench để thêm `patient_accounts` và `login_sessions`. Dữ liệu lịch hẹn cũ
được giữ nguyên; các tài khoản mới đăng ký sẽ được liên kết với hồ sơ bệnh nhân
và chỉ xem được lịch của mình.

Mật khẩu từ tài khoản khách cũ không thể khôi phục vì trước đây chưa có tài
khoản đăng nhập. Nếu email đã được lưu trong hồ sơ cũ, cần xử lý/liên kết hồ sơ
đó trước khi đăng ký. Nhân viên quản trị không còn được mở từ giao diện bệnh
nhân; phân quyền staff/admin cần được thiết kế riêng trước khi bổ sung.

## Kiểm tra luồng riêng tư

1. Đăng ký hai tài khoản với email và số điện thoại khác nhau.
2. Đăng nhập tài khoản A, tạo lịch; xác nhận lịch xuất hiện trong “Lịch hẹn của tôi”.
3. Đăng xuất, đăng nhập tài khoản B; tài khoản B không được nhìn thấy lịch của A.
4. Gửi yêu cầu hủy bằng ID lịch của A trong phiên B; API phải trả `404`.
5. Đăng xuất và gọi `GET /api/appointments`; API phải trả `401`.

## Cấu trúc project

```text
.
├── clinic_appointment.sql
├── migrations/
│   └── 001_patient_accounts.sql
├── server/
│   ├── db.js
│   └── index.js
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── docs/
│   └── requirements-design.md
└── package.json
```

Xem [docs/requirements-design.md](./docs/requirements-design.md) để biết các
User Story, sơ đồ CSDL và mối liên hệ tài khoản-bệnh nhân-lịch hẹn.
