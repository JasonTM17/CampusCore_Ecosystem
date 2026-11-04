/** Auth-surface copy (login page, forced password rotation gate). */
export interface AuthPagesCopy {
  login: {
    demoIntro: string; quickFill: string; chooseDemoAria: string; leaderBadge: string;
    sharedPassword: string; signedOutTitle: string; securedTitle: string;
    dismissNoticeAria: string; demoSectionAria: string; forgotPassword: string;
    contactPrefix: string; or: string; sso: string;
  };
  passwordRotation: {
    title: string; description: string; currentLabel: string; newLabel: string;
    confirmLabel: string; hint: string; submit: string; saving: string;
    success: string; failed: string;
  };
}

export const authPagesEn: AuthPagesCopy = {
  login: {
    demoIntro: 'Demo account to experience the system:', quickFill: 'Quick fill',
    chooseDemoAria: 'Choose a demo student account', leaderBadge: 'Leader',
    sharedPassword: 'Shared password', signedOutTitle: 'Signed Out Securely',
    securedTitle: 'System Secured', dismissNoticeAria: 'Dismiss notice',
    demoSectionAria: 'Demo experience account', forgotPassword: 'Forgot your password?',
    contactPrefix: 'Contact ', or: 'or', sso: 'Sign in with SSO',
  },
  passwordRotation: {
    title: 'Rotate your temporary credential',
    description:
      'Your account was issued by the Academic Office with a temporary password. Set a new one to continue using the portal.',
    currentLabel: 'Temporary password', newLabel: 'New password',
    confirmLabel: 'Confirm new password',
    hint: 'Between 8 and 128 characters with at least one letter and one digit; it must not contain your email address.',
    submit: 'Rotate and sign in again', saving: 'Updating...',
    success: 'Password rotated. Please sign in again with the new one.',
    failed: 'Could not rotate the password. Check the temporary credential and retry.',
  },
};

export const authPagesVi: AuthPagesCopy = {
  login: {
    demoIntro: 'Tài khoản demo để trải nghiệm:', quickFill: 'Điền nhanh',
    chooseDemoAria: 'Chọn tài khoản sinh viên demo', leaderBadge: 'Nhóm trưởng',
    sharedPassword: 'Mật khẩu chung', signedOutTitle: 'Đã đăng xuất an toàn',
    securedTitle: 'Bảo mật hệ thống', dismissNoticeAria: 'Đóng thông báo',
    demoSectionAria: 'Tài khoản demo để trải nghiệm', forgotPassword: 'Quên mật khẩu?',
    contactPrefix: 'Liên hệ ', or: 'hoặc', sso: 'Đăng nhập qua SSO',
  },
  passwordRotation: {
    title: 'Đổi mật khẩu tạm thời',
    description:
      'Tài khoản của bạn do Phòng Đào tạo cấp bằng mật khẩu tạm thời. Hãy đặt mật khẩu mới để tiếp tục sử dụng cổng thông tin.',
    currentLabel: 'Mật khẩu tạm thời', newLabel: 'Mật khẩu mới',
    confirmLabel: 'Nhập lại mật khẩu mới',
    hint: 'Từ 8 đến 128 ký tự, có ít nhất một chữ cái và một chữ số; không được chứa địa chỉ email của bạn.',
    submit: 'Đổi mật khẩu và đăng nhập lại', saving: 'Đang cập nhật...',
    success: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.',
    failed: 'Không thể đổi mật khẩu. Hãy kiểm tra mật khẩu tạm thời và thử lại.',
  },
};
