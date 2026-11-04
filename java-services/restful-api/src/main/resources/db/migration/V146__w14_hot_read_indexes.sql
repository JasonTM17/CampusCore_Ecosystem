CREATE INDEX IF NOT EXISTS academic_enrollment_enrolled_at_idx
    ON academic."Enrollment" ("enrolledAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS academic_attendance_date_id_idx
    ON academic."Attendance" ("date" DESC, "id" ASC);

CREATE INDEX IF NOT EXISTS attendance_checkin_session_created_idx
    ON academic."AttendanceCheckin" ("sessionId", "createdAt", "id");

CREATE INDEX IF NOT EXISTS thesis_topic_supervisor_lecturer_idx
    ON thesis.thesis_topic_supervisor (lecturer_id);

CREATE INDEX IF NOT EXISTS thesis_group_member_student_idx
    ON thesis.thesis_group_member (student_id);

CREATE INDEX IF NOT EXISTS notification_user_created_id_idx
    ON notifications.notification (user_id, created_at DESC, id DESC);
