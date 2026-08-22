-- SkinSense Database Schema
-- Based on ER Diagram from FYP1 Mid Report

BEGIN;

-- User entity
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('patient', 'clinician')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PatientProfile entity
CREATE TABLE IF NOT EXISTS patient_profiles (
    patient_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    age INTEGER,
    gender VARCHAR(20),
    region VARCHAR(100)
);

-- ClinicianProfile entity
CREATE TABLE IF NOT EXISTS clinician_profiles (
    clinician_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    license_number VARCHAR(100) UNIQUE,
    specialization VARCHAR(100)
);

-- Image entity
CREATE TABLE IF NOT EXISTS images (
    image_id SERIAL PRIMARY KEY,
    file_path VARCHAR(500) NOT NULL,
    file_hash VARCHAR(64),
    file_size INTEGER,
    format VARCHAR(10) CHECK (format IN ('JPEG', 'PNG')),
    width INTEGER,
    height INTEGER,
    encrypted BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- VoiceTranscript entity
CREATE TABLE IF NOT EXISTS voice_transcripts (
    transcript_id SERIAL PRIMARY KEY,
    audio_file_path VARCHAR(500),
    transcript_text TEXT,
    language VARCHAR(5) CHECK (language IN ('ur', 'en')),
    confidence_score FLOAT,
    duration_seconds INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prediction entity
CREATE TABLE IF NOT EXISTS predictions (
    prediction_id SERIAL PRIMARY KEY,
    model_version VARCHAR(50),
    top_condition VARCHAR(100),
    confidence_score FLOAT,
    all_scores JSONB,
    heatmap_path VARCHAR(500),
    inference_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ScreeningCase entity
CREATE TABLE IF NOT EXISTS screening_cases (
    case_id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patient_profiles(patient_id),
    image_id INTEGER REFERENCES images(image_id),
    transcript_id INTEGER REFERENCES voice_transcripts(transcript_id),
    prediction_id INTEGER REFERENCES predictions(prediction_id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ExtractedSymptom entity
CREATE TABLE IF NOT EXISTS extracted_symptoms (
    symptom_id SERIAL PRIMARY KEY,
    transcript_id INTEGER REFERENCES voice_transcripts(transcript_id) ON DELETE CASCADE,
    symptom_text VARCHAR(255),
    keyword VARCHAR(100),
    confidence FLOAT
);

-- ClinicianFeedback entity
CREATE TABLE IF NOT EXISTS clinician_feedback (
    feedback_id SERIAL PRIMARY KEY,
    case_id INTEGER REFERENCES screening_cases(case_id),
    clinician_id INTEGER REFERENCES clinician_profiles(clinician_id),
    decision VARCHAR(20) CHECK (decision IN ('accept', 'dispute', 'correct')),
    corrected_diagnosis VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AuditLog entity
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    ip_address VARCHAR(45),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance (from Table 3.4)
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_screening_patient ON screening_cases(patient_id, created_at);
CREATE INDEX idx_screening_status ON screening_cases(status);
CREATE INDEX idx_prediction_model ON predictions(model_version, created_at);
CREATE INDEX idx_feedback_case ON clinician_feedback(case_id, clinician_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id, timestamp);

COMMIT;
