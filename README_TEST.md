# Bài quá trình: Viết unit test script

**Nhóm 08** – Đề tài: Phần mềm đặt lịch hẹn phòng khám (Clinic Appointment System)

## 1. Thành viên

| STT | Họ và tên   | MSSV       | Nhiệm vụ                                              |
|-----|-------------|------------|-------------------------------------------------------|
| 1   | Lê Anh Quân | 3120223155 | Chọn công cụ, viết test script, chạy và báo cáo kết quả |

## 2. Công cụ và chức năng được test

- **Công cụ:** [Vitest](https://vitest.dev) `^5.1.1` (dự án đã dùng Vite + ES Modules nên chạy ngay, không cần cấu hình thêm).
- **Chức năng:** hàm `hashToken()` trong [`server/auth.js`](./server/auth.js) – băm token phiên đăng nhập bằng SHA-256 (hex, 64 ký tự) trước khi lưu vào `login_sessions` / `staff_sessions` (US-03, US-10).
- **Test script:** [`tests/hashToken.test.js`](./tests/hashToken.test.js) – 11 test case (TC01–TC11, TC11 chạy với 4 giá trị nên có 14 phép kiểm tra).

| Mã   | Mô tả                                              | Kết quả mong đợi                            |
|------|----------------------------------------------------|---------------------------------------------|
| TC01 | `"abc"`                                            | Đúng vector chuẩn SHA-256                   |
| TC02 | Chuỗi rỗng                                         | Đúng vector chuẩn SHA-256                   |
| TC03 | Token ngẫu nhiên base64url                         | Bằng hash tính độc lập bằng `node:crypto`   |
| TC04 | Token Unicode (tiếng Việt)                         | Bằng hash tính độc lập bằng `node:crypto`   |
| TC05 | Định dạng đầu ra                                   | 64 ký tự hex thường                         |
| TC06 | Không lộ token gốc                                 | Hash không chứa token gốc                   |
| TC07 | Cùng token gọi 2 lần                               | Hai kết quả giống nhau                      |
| TC08 | Hai token khác nhau                                | Hai hash khác nhau                          |
| TC09 | `"abc"` và `"ABC"`                                 | Hai hash khác nhau                          |
| TC10 | `"abc"` và `"abc "`                                | Hai hash khác nhau                          |
| TC11 | `undefined`, `null`, `12345`, `{}`                 | Hàm ném lỗi                                 |

## 3. Thủ tục chạy test script

**Yêu cầu:** Node.js 20 trở lên, npm, Git. Không cần MySQL, không cần file `.env` (hàm được test không truy cập CSDL).

```bash
git clone https://github.com/quanlee1352005/clinic_appointment.git
cd clinic_appointment
npm install
npm test
```

Xem chi tiết từng test case:

```bash
npx vitest run tests/hashToken.test.js --reporter=verbose
```

**Kết quả mong đợi:** `Test Files 1 passed (1)` và `Tests 14 passed (14)`, mã thoát 0.
