package io.campuscore.restfulapi.notification.push;

/** Provider boundary. A receipt is required before an outbox row can become SENT. */
public interface PushProvider {

    boolean isConfigured();

    DeliveryReceipt send(String provider, String token, PushPayload payload) throws Exception;

    record PushPayload(String title, String body, String notificationId) {

        public static final String GENERIC_TITLE = "CampusCore";
        public static final String GENERIC_BODY =
                "Bạn có thông báo mới / You have a new notification";

        public PushPayload {
            if (!GENERIC_TITLE.equals(title) || !GENERIC_BODY.equals(body)) {
                throw new IllegalArgumentException("Push payload text must remain generic");
            }
            if (notificationId == null || notificationId.isBlank()) {
                throw new IllegalArgumentException("Notification ID is required");
            }
        }

        public static PushPayload forNotification(String notificationId) {
            return new PushPayload(GENERIC_TITLE, GENERIC_BODY, notificationId);
        }
    }

    record DeliveryReceipt(boolean accepted) { }

    final class PushProviderException extends Exception {
        private final String code;
        private final boolean retryable;

        public PushProviderException(String code, boolean retryable) {
            super("Push provider returned an unsuccessful result");
            this.code = code;
            this.retryable = retryable;
        }

        public String code() { return code; }
        public boolean retryable() { return retryable; }
    }
}
