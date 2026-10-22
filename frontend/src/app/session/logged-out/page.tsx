import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Đã đăng xuất — CampusUTE',
  robots: { index: false },
};

/**
 * Post-logout landing owned by Next (docs/ecosystem/host-policy.md §3 —
 * the Java BFF only returns a probe; this static page is the real
 * destination the `id` host's /connect/logout redirects back to).
 */
export default function LoggedOutPage() {
  return (
    <main
      style={{
        display: 'flex',
        minHeight: '60vh',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
          Bạn đã đăng xuất
        </h1>
        <p style={{ color: '#555', marginBottom: '1.5rem' }}>
          Phiên đăng nhập của bạn đã kết thúc trên mọi thiết bị liên kết
          với tài khoản này.
        </p>
        <a
          href="/"
          style={{
            color: '#1d4ed8',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Về trang chủ
        </a>
      </div>
    </main>
  );
}
