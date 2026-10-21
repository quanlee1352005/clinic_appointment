CREATE DATABASE IF NOT EXISTS clinic_appointment
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;
USE clinic_appointment;

CREATE TABLE IF NOT EXISTS specialties (
    specialty_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    description VARCHAR(500)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patients (
    patient_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(160) NOT NULL,
    date_of_birth DATE,
    gender ENUM('female', 'male', 'other', 'unspecified') NOT NULL DEFAULT 'unspecified',
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(254) UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    INDEX idx_patients_phone (phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_accounts (
    account_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id BIGINT UNSIGNED NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_patient_accounts_patient
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_sessions (
    session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    account_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_login_sessions_account
        FOREIGN KEY (account_id) REFERENCES patient_accounts(account_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_login_sessions_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctors (
    doctor_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    specialty_id BIGINT UNSIGNED NOT NULL,
    full_name VARCHAR(160) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(254) UNIQUE,
    biography TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_doctors_specialty
        FOREIGN KEY (specialty_id) REFERENCES specialties(specialty_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_doctors_specialty_active (specialty_id, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS services (
    service_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    description VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- Bang ket hop N-N: mot bac si cung cap nhieu dich vu va mot dich vu co the
-- duoc nhieu bac si cung cap. Thoi luong/gia co the khac nhau theo bac si.
CREATE TABLE IF NOT EXISTS doctor_services (
    doctor_id BIGINT UNSIGNED NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (doctor_id, service_id),
    CONSTRAINT chk_doctor_services_duration CHECK (duration_minutes > 0),
    CONSTRAINT chk_doctor_services_price CHECK (price >= 0),
    CONSTRAINT fk_doctor_services_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_doctor_services_service
        FOREIGN KEY (service_id) REFERENCES services(service_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_doctor_services_service (service_id, is_active)
) ENGINE=InnoDB;

-- MySQL DAYOFWEEK(): 1=Chu nhat, 2=Thu hai, ..., 7=Thu bay.
CREATE TABLE IF NOT EXISTS doctor_schedules (
    schedule_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doctor_id BIGINT UNSIGNED NOT NULL,
    day_of_week TINYINT UNSIGNED NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_schedules_weekday CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT chk_schedules_time CHECK (start_time < end_time),
    CONSTRAINT fk_schedules_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    UNIQUE KEY uq_doctor_schedule_start (doctor_id, day_of_week, start_time),
    INDEX idx_schedules_doctor_day (doctor_id, day_of_week, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctor_days_off (
    day_off_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doctor_id BIGINT UNSIGNED NOT NULL,
    off_date DATE NOT NULL,
    reason VARCHAR(255),
    CONSTRAINT fk_days_off_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    UNIQUE KEY uq_doctor_day_off (doctor_id, off_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
    appointment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id BIGINT UNSIGNED NOT NULL,
    doctor_id BIGINT UNSIGNED NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    status ENUM('pending', 'confirmed', 'completed', 'cancelled', 'no_show')
        NOT NULL DEFAULT 'pending',
    patient_note VARCHAR(1000),
    -- Luu snapshot de lich su khong doi khi gia/ten/thoi luong dich vu thay doi.
    service_name_snapshot VARCHAR(160) NOT NULL,
    duration_minutes_snapshot SMALLINT UNSIGNED NOT NULL,
    price_snapshot DECIMAL(10, 2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_appointments_time CHECK (start_at < end_at),
    CONSTRAINT chk_appointments_same_day CHECK (DATE(start_at) = DATE(end_at)),
    CONSTRAINT chk_appointments_duration CHECK (duration_minutes_snapshot > 0),
    CONSTRAINT chk_appointments_price CHECK (price_snapshot >= 0),
    CONSTRAINT fk_appointments_patient
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_doctor_service
        FOREIGN KEY (doctor_id, service_id)
        REFERENCES doctor_services(doctor_id, service_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_appointments_doctor_start_status (doctor_id, start_at, status),
    INDEX idx_appointments_patient_start_status (patient_id, start_at, status)
) ENGINE=InnoDB;

-- Dat lich qua procedure nay de khoa bac si/benh nhan, kiem tra slot va
-- ghi appointment trong cung transaction. Quy tac overlap:
-- lich hien co bat dau truoc gio ket thuc moi va ket thuc sau gio bat dau moi.
DELIMITER //
DROP PROCEDURE IF EXISTS sp_create_appointment//
CREATE PROCEDURE sp_create_appointment(
    IN p_patient_id BIGINT UNSIGNED,
    IN p_doctor_id BIGINT UNSIGNED,
    IN p_service_id BIGINT UNSIGNED,
    IN p_start_at DATETIME,
    IN p_patient_note VARCHAR(1000)
)
BEGIN
    DECLARE v_locked_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_duration SMALLINT UNSIGNED DEFAULT NULL;
    DECLARE v_price DECIMAL(10, 2) DEFAULT NULL;
    DECLARE v_service_name VARCHAR(160) DEFAULT NULL;
    DECLARE v_end_at DATETIME;
    DECLARE v_count INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_start_at IS NULL OR p_start_at <= CURRENT_TIMESTAMP THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Thời điểm hẹn phải nằm trong tương lai.';
    END IF;

    SET v_end_at = p_start_at;

    START TRANSACTION;

    -- Khoa theo bac si truoc de cac yeu cau cung bac si duoc xu ly lan luot.
    SET v_locked_id = NULL;
    SELECT doctor_id INTO v_locked_id
    FROM doctors
    WHERE doctor_id = p_doctor_id AND is_active = TRUE
    FOR UPDATE;
    IF v_locked_id IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Bác sĩ không tồn tại hoặc đang ngừng hoạt động.';
    END IF;

    -- Khoa benh nhan de ngan dat chong lich cho cung mot benh nhan
    -- o hai bac si khac nhau trong cung thoi diem.
    SET v_locked_id = NULL;
    SELECT patient_id INTO v_locked_id
    FROM patients
    WHERE patient_id = p_patient_id AND is_active = TRUE
    FOR UPDATE;
    IF v_locked_id IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Bệnh nhân không tồn tại hoặc đang ngừng hoạt động.';
    END IF;

    SELECT ds.duration_minutes, ds.price, s.name
      INTO v_duration, v_price, v_service_name
    FROM doctor_services AS ds
    JOIN services AS s ON s.service_id = ds.service_id
    WHERE ds.doctor_id = p_doctor_id
      AND ds.service_id = p_service_id
      AND ds.is_active = TRUE
      AND s.is_active = TRUE;

    IF v_duration IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Dịch vụ không tồn tại hoặc bác sĩ không cung cấp dịch vụ này.';
    END IF;

    SET v_end_at = DATE_ADD(p_start_at, INTERVAL v_duration MINUTE);
    IF DATE(p_start_at) <> DATE(v_end_at) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Lịch hẹn không được kéo dài qua ngày hôm sau.';
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM doctor_schedules
    WHERE doctor_id = p_doctor_id
      AND day_of_week = DAYOFWEEK(p_start_at)
      AND is_active = TRUE
      AND start_time <= TIME(p_start_at)
      AND end_time >= TIME(v_end_at);
    IF v_count = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Thời gian hẹn nằm ngoài lịch làm việc của bác sĩ.';
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM doctor_days_off
    WHERE doctor_id = p_doctor_id
      AND off_date = DATE(p_start_at);
    IF v_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Bác sĩ nghỉ vào ngày được chọn.';
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM appointments
    WHERE doctor_id = p_doctor_id
      AND status NOT IN ('cancelled', 'no_show')
      AND start_at < v_end_at
      AND end_at > p_start_at;
    IF v_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Bác sĩ đã có lịch hẹn trùng thời gian.';
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM appointments
    WHERE patient_id = p_patient_id
      AND status NOT IN ('cancelled', 'no_show')
      AND start_at < v_end_at
      AND end_at > p_start_at;
    IF v_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Bệnh nhân đã có lịch hẹn trùng thời gian.';
    END IF;

    INSERT INTO appointments (
        patient_id, doctor_id, service_id, start_at, end_at, status,
        patient_note, service_name_snapshot, duration_minutes_snapshot,
        price_snapshot
    )
    VALUES (
        p_patient_id, p_doctor_id, p_service_id, p_start_at, v_end_at, 'pending',
        p_patient_note, v_service_name, v_duration, v_price
    );

    COMMIT;
    SELECT LAST_INSERT_ID() AS appointment_id;
END//
DELIMITER ;

-- Du lieu mau de thuc hanh (khong chua thong tin ca nhan that).
INSERT IGNORE INTO specialties (specialty_id, name, description) VALUES
    (1, 'Nội tổng quát', 'Khám và tư vấn các vấn đề nội khoa'),
    (2, 'Da liễu', 'Khám và tư vấn các bệnh về da');

INSERT IGNORE INTO patients
    (patient_id, full_name, date_of_birth, gender, phone, email) VALUES
    (1, 'Nguyễn Văn Mẫu', '1998-05-20', 'male', '0900000001', 'patient@example.test');

INSERT IGNORE INTO doctors
    (doctor_id, specialty_id, full_name, phone, email, biography) VALUES
    (1, 1, 'Bác sĩ Mẫu 1', '0900000011', 'doctor1@example.test', 'Bác sĩ nội tổng quát'),
    (2, 2, 'Bác sĩ Mẫu 2', '0900000012', 'doctor2@example.test', 'Bác sĩ da liễu');

INSERT IGNORE INTO services (service_id, name, description) VALUES
    (1, 'Khám tổng quát', 'Khám sức khỏe tổng quát'),
    (2, 'Tư vấn da liễu', 'Tư vấn và khám các vấn đề về da');

INSERT IGNORE INTO doctor_services
    (doctor_id, service_id, duration_minutes, price) VALUES
    (1, 1, 30, 250000.00),
    (2, 2, 30, 300000.00);

INSERT IGNORE INTO doctor_schedules
    (doctor_id, day_of_week, start_time, end_time) VALUES
    (1, 2, '08:00:00', '17:00:00'),
    (1, 3, '08:00:00', '17:00:00'),
    (1, 4, '08:00:00', '17:00:00'),
    (1, 5, '08:00:00', '17:00:00'),
    (1, 6, '08:00:00', '17:00:00'),
    (1, 7, '08:00:00', '17:00:00'),
    (2, 2, '08:00:00', '17:00:00'),
    (2, 3, '08:00:00', '17:00:00'),
    (2, 4, '08:00:00', '17:00:00'),
    (2, 5, '08:00:00', '17:00:00'),
    (2, 6, '08:00:00', '17:00:00'),
    (2, 7, '08:00:00', '17:00:00');

-- Vi du dat lich vao thu hai tuan toi: bo dau -- de chay.
-- SET @ngay_hen = DATE_ADD(CURDATE(), INTERVAL 1 DAY);
-- SET @ngay_hen = DATE_ADD(@ngay_hen,
--     INTERVAL ((9 - DAYOFWEEK(@ngay_hen)) % 7) DAY);
-- CALL sp_create_appointment(
--     1, 1, 1, TIMESTAMP(@ngay_hen, '09:00:00'), 'Kham lan dau'
-- );

-- Truy van xem lich hen kem ten benh nhan, bac si va dich vu.
-- SELECT a.appointment_id, a.start_at, a.end_at, a.status,
--        p.full_name AS patient, d.full_name AS doctor,
--        a.service_name_snapshot, a.price_snapshot
-- FROM appointments AS a
-- JOIN patients AS p ON p.patient_id = a.patient_id
-- JOIN doctors AS d ON d.doctor_id = a.doctor_id
-- ORDER BY a.start_at;