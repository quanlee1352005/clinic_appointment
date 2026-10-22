// Tạo (hoặc đặt lại mật khẩu) tài khoản nhân viên phòng khám.
// Cách dùng: npm run create-staff -- email@antam.vn "Họ và tên" "MatKhau-It-Nhat-10-Ky-Tu"
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const [email, fullName, password] = process.argv.slice(2);
const normalizedEmail = (email ?? "").trim().toLowerCase();

if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
  !fullName ||
  fullName.trim().length < 2 ||
  !password ||
  password.length < 10 ||
  password.length > 72
) {
  console.error('Cách dùng: npm run create-staff -- email@antam.vn "Họ và tên" "MatKhau-10-ky-tu-tro-len"');
  process.exit(1);
}

try {
  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO staff_accounts (full_name, email, password_hash)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name),
       password_hash = VALUES(password_hash), is_active = TRUE`,
    [fullName.trim(), normalizedEmail, hash],
  );
  console.log(`Đã tạo/cập nhật tài khoản nhân viên: ${normalizedEmail}`);
} catch (error) {
  console.error("Không tạo được tài khoản nhân viên:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
