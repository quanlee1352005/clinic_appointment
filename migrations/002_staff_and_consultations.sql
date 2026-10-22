-- Chay migration nay MOT LAN tren database clinic_appointment da co du lieu.
-- Khong xoa/sua lich hen cu. Them: tai khoan nhan vien, phien nhan vien,
-- cot xu ly lich hen, va hai bang tu van truc tuyen.
USE clinic_appointment;

CREATE TABLE IF NOT EXISTS staff_accounts (
    staff_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(160) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_sessions (
    session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_staff_sessions_staff
        FOREIGN KEY (staff_id) REFERENCES staff_accounts(staff_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_staff_sessions_expiry (expires_at)
) ENGINE=InnoDB;

-- Cot ghi nhan nhan vien xu ly lich (xac nhan / tu choi / hoan thanh ...).
-- Neu bao loi "Duplicate column name" nghia la da chay migration nay roi.
ALTER TABLE appointments
    ADD COLUMN staff_note VARCHAR(500) NULL AFTER patient_note,
    ADD COLUMN handled_by_staff_id BIGINT UNSIGNED NULL,
    ADD COLUMN handled_at DATETIME NULL,
    ADD CONSTRAINT fk_appointments_staff
        FOREIGN KEY (handled_by_staff_id) REFERENCES staff_accounts(staff_id)
        ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS consultations (
    consultation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id BIGINT UNSIGNED NOT NULL,
    specialty_id BIGINT UNSIGNED NULL,
    subject VARCHAR(160) NOT NULL,
    status ENUM('open', 'answered', 'closed') NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    CONSTRAINT fk_consultations_patient
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_consultations_specialty
        FOREIGN KEY (specialty_id) REFERENCES specialties(specialty_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_consultations_patient (patient_id, updated_at),
    INDEX idx_consultations_status (status, updated_at)
) ENGINE=InnoDB;

-- Khong dat ON UPDATE/DELETE cho staff_id vi cot nay nam trong rang buoc CHECK
-- (MySQL cam ket hop). Nhan vien nghi viec se bi vo hieu hoa (is_active), khong xoa.
CREATE TABLE IF NOT EXISTS consultation_messages (
    message_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    consultation_id BIGINT UNSIGNED NOT NULL,
    sender_type ENUM('patient', 'staff') NOT NULL,
    staff_id BIGINT UNSIGNED NULL,
    body VARCHAR(2000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_consultation_sender CHECK (
        (sender_type = 'staff' AND staff_id IS NOT NULL)
        OR (sender_type = 'patient' AND staff_id IS NULL)
    ),
    CONSTRAINT fk_consultation_messages_consultation
        FOREIGN KEY (consultation_id) REFERENCES consultations(consultation_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_consultation_messages_staff
        FOREIGN KEY (staff_id) REFERENCES staff_accounts(staff_id),
    INDEX idx_consultation_messages_thread (consultation_id, message_id)
) ENGINE=InnoDB;
