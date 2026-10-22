# Hệ thống đặt lịch hẹn dịch vụ thăm khám

Website dùng **React + Vite**, **Node.js + Express** và **MySQL 8.0.16+** (chạy được cả MariaDB 10.5+).
Bệnh nhân đăng ký/đăng nhập, đặt lịch, tư vấn trực tuyến với phòng khám và chỉ xem/hủy lịch của
tài khoản mình. Nhân viên phòng khám có khu vực riêng để xử lý lịch, quản lý ca làm của bác sĩ
và trả lời tư vấn.

## Tính năng

**Bệnh nhân**
- Trang giới thiệu và danh mục dịch vụ/bác sĩ.
- Đăng ký tài khoản bằng email, đăng nhập, đăng xuất; mật khẩu được băm bằng bcrypt.
- Phiên đăng nhập lưu phía máy chủ; cookie `HttpOnly`, `SameSite=Lax`, thời hạn
  7 ngày. Cookie tự bật `Secure` khi chạy với `NODE_ENV=production`.
- Đặt lịch sau khi đăng nhập; máy chủ xác minh giờ làm, ngày nghỉ và xung đột.
- “Lịch hẹn của tôi”: xem trạng thái, thấy lý do nếu phòng khám từ chối/hủy, tự hủy lịch sắp tới.
- **Tư vấn trực tuyến**: gửi câu hỏi, nhận phản hồi và nhắn tiếp với nhân viên phòng khám
  (người thật trả lời, **không dùng AI**); trang tự làm mới 8 giây/lần.

**Nhân viên phòng khám** (vào bằng `http://localhost:5173/#staff` hoặc liên kết “Dành cho nhân viên” ở chân trang)
- Tài khoản, phiên và cookie riêng, tách hoàn toàn khỏi bệnh nhân (phiên 12 giờ).
- **Lịch hẹn**: lọc theo trạng thái/ngày/bác sĩ, xem thông tin bệnh nhân; xác nhận, từ chối
  (bắt buộc lý do), hủy, đánh dấu hoàn thành hoặc không đến.
- **Lịch bác sĩ**: thêm/sửa/tắt/xóa ca làm theo thứ, thêm/bỏ ngày nghỉ; cảnh báo số lịch bị ảnh hưởng.
- **Tư vấn**: hàng đợi câu hỏi (lâu nhất lên đầu), trả lời, kết thúc cuộc tư vấn.
- Huy hiệu số lịch chờ và tư vấn chờ trên menu.

## Yêu cầu

- Node.js 20 trở lên
- npm
- MySQL 8.0.16 trở lên (hoặc MariaDB 10.5+)

## Cài đặt mới

1. Chạy toàn bộ [clinic_appointment.sql](./clinic_appointment.sql) trong MySQL
   Workbench/phpMyAdmin. Script tạo database, bảng, procedure và dữ liệu dịch vụ mẫu.
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
   npm run create-staff -- nhanvien@antam.vn "Lễ tân An Tâm" "MatKhau-It-Nhat-10-Ky-Tu"
   npm run dev
   ```

   Lệnh `create-staff` tạo tài khoản nhân viên (chạy lại với cùng email để đặt lại mật khẩu).

4. Mở `http://localhost:5173`, chọn **Tạo tài khoản** để dùng với tư cách bệnh nhân;
   mở `http://localhost:5173/#staff` để đăng nhập nhân viên. API health check ở
   `http://localhost:3001/api/health`.

## Nâng cấp database đã tạo trước đó

Không cần xóa database hoặc lịch hẹn. Chạy **lần lượt, mỗi file một lần**:

1. [migrations/001_patient_accounts.sql](./migrations/001_patient_accounts.sql) — nếu database
   chưa có bảng `patient_accounts`/`login_sessions`.
2. [migrations/002_staff_and_consultations.sql](./migrations/002_staff_and_consultations.sql) — thêm
   tài khoản nhân viên, cột xử lý lịch (`staff_note`, `handled_by_staff_id`, `handled_at`) và hai bảng
   tư vấn. Nếu báo `Duplicate column name` nghĩa là đã chạy rồi.

Sau đó tạo tài khoản nhân viên bằng `npm run create-staff` như trên. Dữ liệu lịch hẹn cũ được giữ nguyên.

Nếu seed cũ có dòng gán dịch vụ da liễu cho bác sĩ nội tổng quát, tắt nó bằng:
`UPDATE doctor_services SET is_active = FALSE WHERE doctor_id = 1 AND service_id = 2;`

## Kiểm tra luồng riêng tư và phân quyền

1. Đăng ký hai tài khoản bệnh nhân với email và số điện thoại khác nhau.
2. Đăng nhập tài khoản A, tạo lịch; xác nhận lịch xuất hiện trong “Lịch hẹn của tôi”.
3. Đăng xuất, đăng nhập tài khoản B; tài khoản B không được nhìn thấy lịch của A.
4. Gửi yêu cầu hủy bằng ID lịch của A trong phiên B; API phải trả `404`.
5. Đăng xuất và gọi `GET /api/appointments`; API phải trả `401`.
6. Gọi `GET /api/staff/appointments` bằng phiên bệnh nhân hoặc khi chưa đăng nhập; API phải trả `401`.
7. Đăng nhập nhân viên, xác nhận lịch của A và từ chối lịch của B kèm lý do; đăng nhập lại từng
   bệnh nhân để thấy trạng thái mới.
8. Gửi câu hỏi tư vấn bằng A, trả lời bằng nhân viên; B không đọc được cuộc tư vấn của A (`404`).

## Cấu trúc project

```text
.
├── clinic_appointment.sql
├── .env.example
├── migrations/
│   ├── 001_patient_accounts.sql
│   └── 002_staff_and_consultations.sql
├── server/
│   ├── db.js
│   ├── auth.js              # cookie, phiên, middleware bệnh nhân/nhân viên
│   ├── index.js             # auth bệnh nhân, danh mục, đặt/hủy lịch
│   ├── staff.js             # API nhân viên: lịch hẹn, ca làm, ngày nghỉ, tư vấn
│   ├── consultations.js     # API tư vấn của bệnh nhân + hàm dùng chung
│   └── create-staff.js      # tạo tài khoản nhân viên
├── src/
│   ├── App.jsx              # giao diện bệnh nhân
│   ├── Consultation.jsx     # trang tư vấn trực tuyến
│   ├── Staff.jsx            # khu vực nhân viên
│   ├── api.js
│   ├── main.jsx
│   └── styles.css
├── docs/
│   └── requirements-design.md
└── package.json
```

Xem [docs/requirements-design.md](./docs/requirements-design.md) để biết các
User Story, sơ đồ CSDL và quy tắc xử lý lịch.

## Về thư mục `node_modules`

`npm install` tải các thư viện khai báo trong `package.json` cùng các thư viện mà chúng phụ thuộc
(project này khoảng 180 gói). Thư mục này rất nặng nhưng chỉ là bản tải về, đã được `.gitignore`
loại khỏi GitHub. **Không nộp hoặc nén kèm `node_modules`**; người khác chỉ cần chạy `npm install`.
