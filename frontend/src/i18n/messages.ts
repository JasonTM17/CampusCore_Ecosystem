import type { Locale } from '@/i18n/config';

export const en = {
  common: {
    locale: {
      label: 'Language',
      english: 'English',
      vietnamese: 'Vietnamese',
      switchToEnglish: 'Switch to English',
      switchToVietnamese: 'Chuyển sang tiếng Việt',
    },
    actions: {
      signIn: 'Sign in',
      signOut: 'Sign out',
      save: 'Save',
      saveChanges: 'Save changes',
      cancel: 'Cancel',
      confirm: 'Confirm',
      retry: 'Try again',
      refresh: 'Refresh data',
      openTool: 'Open tool',
      openView: 'Open view',
      openWorkspace: 'Open workspace',
      returnHome: 'Return to the homepage',
      openDashboard: 'Open dashboard',
      continueToWorkspace: 'Continue to workspace',
      signInToWorkspace: 'Sign in to workspace',
      reviewAdmin: 'Review admin surfaces',
      browseSections: 'Browse sections',
      clearFilters: 'Clear filters',
      openAnalytics: 'Open analytics',
      addUser: 'Add user',
      createUser: 'Create user',
      search: 'Search',
      backToSignIn: 'Back to sign in',
      requestNewResetLink: 'Request a new reset link',
      tryAnotherEmail: 'Try another email',
      updatePassword: 'Update password',
      reviewProfileSettings: 'Review profile settings',
      openAnnouncements: 'Open announcements',
    },
    states: {
      loadingContent: 'Loading content',
      loading: 'Loading...',
      closeModal: 'Close modal',
      goToPreviousPage: 'Go to previous page',
      goToNextPage: 'Go to next page',
      searchPlaceholder: 'Search...',
      export: 'Export',
      noDataFound: 'No data found',
      showingResults: 'Showing',
      to: 'to',
      of: 'of',
      results: 'results',
      page: 'Page',
      perPage10: '10 per page',
      perPage25: '25 per page',
      perPage50: '50 per page',
      perPage100: '100 per page',
    },
  },
  meta: {
    defaults: {
      siteName: 'CampusCore',
      title: 'Campus operations workspace',
      description:
        'CampusCore is a campus operations workspace for identity, academics, finance, engagement, people data, and analytics.',
      ogAlt: 'CampusCore workspace overview',
      twitterTitle: 'CampusCore',
      twitterDescription:
        'A campus operations workspace for academics, finance, engagement, analytics, and secure browser sessions.',
    },
    home: {
      title: 'Campus operations workspace',
      description:
        'CampusCore gives operators, lecturers, and students one steady workspace while keeping auth, academics, finance, analytics, and people workflows inside clear service boundaries.',
    },
    login: {
      title: 'Sign in',
      description: 'Sign in to CampusCore with your campus account.',
    },
    forgotPassword: {
      title: 'Forgot password',
      description: 'Request a CampusCore password reset link.',
    },
    resetPassword: {
      title: 'Reset password',
      description: 'Set a new CampusCore password and return to the workspace.',
    },
    dashboard: {
      title: 'Workspace',
      description:
        'Protected student and lecturer dashboards for CampusCore.',
    },
    admin: {
      title: 'Admin workspace',
      description: 'Protected administration routes for CampusCore.',
    },
    socialImage: {
      eyebrow: 'CampusCore',
      title: 'Campus operations that stay calm under real load.',
      description:
        'Identity, academics, finance, engagement, people data, and analytics in one release-verified workspace.',
      badges: [
        'Cookie sessions + CSRF',
        '9-image topology',
        'Compose + Kubernetes',
      ],
    },
  },
  home: {
    navSubtitle: 'Campus operations workspace',
    eyebrow: 'CampusCore platform',
    title: 'Academic operations that feel steady, not stitched together.',
    description:
      'CampusCore brings identity, academics, finance, engagement, people data, and analytics into one web workspace while keeping service ownership, release checks, and runtime boundaries clear.',
    metricCards: [
      {
        title: 'Kubernetes-ready',
        description:
          'Local Docker Desktop and release-verified Kustomize paths stay aligned.',
      },
      {
        title: 'Security-first',
        description:
          'Session refresh, CSRF headers, and internal-edge denial remain in place.',
      },
      {
        title: 'Operational clarity',
        description:
          'The UI maps to clear owners instead of collapsing everything back into core.',
      },
    ],
    snapshotEyebrow: 'Runtime snapshot',
    snapshotTitle: 'Verified delivery without hiding the moving parts',
    snapshotChecks: [
      'Dedicated auth, analytics, finance, academic, engagement, and people services',
      'Next.js frontend with cookie session refresh and CSRF-safe mutations',
      'Compose and Kubernetes-first runtime validation',
      'Public edge keeps internal contracts blocked from the browser',
    ],
    snapshotPrimaryAccessTitle: 'Primary access',
    snapshotPrimaryAccessDescription:
      'Students, lecturers, and admins enter through one consistent browser contract.',
    snapshotReleaseTitle: 'Release posture',
    snapshotReleaseDescription:
      'Registry publishing, image verification, and local K8s flows stay traceable.',
    capabilitiesEyebrow: 'What the portal is built to do',
    capabilitiesTitle:
      'One frontend language across the critical campus workflows',
    capabilitiesDescription:
      'The interface is designed for live campus operations, with calmer defaults for auth, data states, and role-aware tasks.',
    pillars: [
      {
        title: 'Identity you can trust',
        description:
          'Cookie-based sessions, CSRF protection, and role-aware routing stay intact across the web client.',
      },
      {
        title: 'Academic workflows',
        description:
          'Registration, schedules, grades, transcript views, and section operations live behind clear service boundaries.',
      },
      {
        title: 'Operational visibility',
        description:
          'Dashboards and reporting move through analytics ownership instead of leaking through unrelated domains.',
      },
      {
        title: 'People ownership',
        description:
          'Student and lecturer records remain readable through the frontend without dragging the UI back into a monolith.',
      },
      {
        title: 'Release discipline',
        description:
          'Compose, Kustomize, CI, registry publishing, and edge checks all point at the same 9-image topology.',
      },
      {
        title: 'Campus-ready shell',
        description:
          'One portal for students, lecturers, and admins with sharper states, fewer dead ends, and calmer navigation.',
      },
    ],
    whyEyebrow: 'Why microservices for CampusCore',
    whyTitle: 'Split ownership where campus operations actually split',
    whyDescription:
      'CampusCore is service-oriented because campus operations do not fail all at once. Identity, academics, finance, engagement, people data, and analytics move at different speeds and deserve different release paths.',
    whyPoints: [
      {
        title: 'Smaller blast radius',
        description:
          'A grading issue should not take down finance, and a billing change should not block sign-in.',
      },
      {
        title: 'Independent auth ownership',
        description:
          'Identity and browser session handling stay owned by auth instead of being scattered across unrelated services.',
      },
      {
        title: 'Scaling by workload',
        description:
          'Analytics, announcements, and enrollment-heavy flows can scale without dragging the entire platform with them.',
      },
      {
        title: 'Release verification',
        description:
          'The 9-image topology makes it easier to trace what was published, what was verified, and what is running now.',
      },
      {
        title: 'Stronger edge boundaries',
        description:
          'Public routes stay readable for the browser while internal contracts stay behind the edge.',
      },
      {
        title: 'Clearer operator handoff',
        description:
          'Compose, Kustomize, and registry verification remain readable because each domain owns a smaller surface.',
      },
    ],
    footerSubtitle: 'Operational workspace',
    footerDescription:
      'A microservices-oriented campus platform focused on stable browser auth, clearer service ownership, and verified runtime delivery.',
    footerWorkspace: 'Workspace',
    footerDelivery: 'Delivery',
    footerLinks: {
      workspace: ['Student access', 'Lecturer workflows', 'Admin operations'],
      delivery: ['Compose and K8s', 'Semver image releases', 'Edge and security verification'],
    },
    footerCopyright: 'All rights reserved.',
  },
  authShell: {
    mobileSubtitle: 'Academic access',
  },
  login: {
    eyebrow: 'Secure access',
    title: 'Sign in to the campus workspace.',
    description:
      'Use the same protected browser session to move across academics, finance, announcements, and operational dashboards.',
    featureTitles: ['Role-aware access', 'Session protection', 'Operational continuity'],
    featureDescriptions: [
      'Admins, lecturers, and students land in the right workspace without a second sign-in step.',
      'Browser auth stays on cookie sessions with CSRF protection and refresh handling.',
      'Core academic, finance, engagement, and analytics flows stay reachable from one portal.',
    ],
    sectionEyebrow: 'Account access',
    heading: 'Welcome back',
    subheading: 'Sign in with your campus account to continue.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@university.edu',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter your password',
    forgotPassword: 'Forgot password?',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    signingIn: 'Signing in',
    sessionBehaviorTitle: 'Session behavior',
    sessionBehaviorDescription:
      'CampusCore uses cookie-based browser sessions with automatic refresh handling and CSRF protection for mutating requests.',
    reasonMessages: {
      sessionExpired: {
        title: 'Your session ended',
        body: 'Sign in again to continue working in CampusCore.',
      },
      unauthorized: {
        title: 'Sign in required',
        body: 'Your last request needed an active session.',
      },
      signedOut: {
        title: 'Signed out',
        body: 'You have been signed out of the workspace.',
      },
    },
    runtimeNotice: {
      infoTitle: 'Development preview',
      infoBody:
        'This local frontend is using the edge proxy. If sign-in stops responding, start the local edge helper or use the public domain.',
      warningTitle: 'Local edge unavailable',
      warningBody:
        'This preview cannot reach the local edge right now. Start the edge helper on {origin} or use the public domain instead of relying on frontend-only preview mode.',
    },
    errors: {
      fallback: 'We could not sign you in right now.',
      invalidCredentials: 'The email address or password is incorrect.',
      blocked: 'This sign-in attempt was blocked. Refresh the page and try again.',
      backendUnavailable:
        'CampusCore could not reach the local edge or auth services. Start the edge helper, confirm the proxy target is healthy, or use the public domain.',
      temporaryUnavailable:
        'Sign-in is temporarily unavailable. Please try again in a moment.',
    },
    returnHomeLead: 'Need a different starting point?',
  },
  forgotPassword: {
    eyebrow: 'Password recovery',
    title: 'Recover account access without guessing.',
    description:
      'Use your campus email to request a reset link. The response stays consistent whether the account exists or not.',
    featureTitles: ['Verified handoff', 'Clear next steps', 'Safer messaging'],
    featureDescriptions: [
      'Password recovery stays on the same browser contract as sign-in and session refresh.',
      'The screen keeps recovery guidance visible instead of dropping you into a dead end.',
      'Responses stay intentionally vague so the flow does not confirm whether an email exists.',
    ],
    sectionEyebrow: 'Recovery flow',
    heading: 'Forgot password',
    beforeSend: 'Enter your email and we will send password reset instructions.',
    afterSend: 'The next step is in your email inbox.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@university.edu',
    emailHint: 'Use the address tied to your campus account.',
    sendResetLink: 'Send reset link',
    sendingResetInstructions: 'Sending reset instructions',
    sentToast: 'If the email exists, a reset link has been sent.',
    failedToast: 'We could not start password recovery right now.',
    sentBanner:
      'If an account matches {email}, a reset link is on the way.',
    sentDescription:
      'Check spam or promotions if you do not see the message right away. You can also start over with another address.',
  },
  resetPassword: {
    eyebrow: 'Reset password',
    title: 'Set a new password and get back into CampusCore.',
    description:
      'Choose a fresh password for your campus account. Once complete, you will sign in again with the updated credentials.',
    featureTitles: ['One secure path', 'Clear requirements', 'Consistent recovery'],
    featureDescriptions: [
      'Reset tokens move back into the same protected sign-in flow instead of branching into a separate experience.',
      'Users see password guidance and validation before the form submits.',
      'Expired or invalid tokens render a stable recovery state instead of a broken page.',
    ],
    invalidTitle: 'This reset link is no longer valid',
    invalidDescription:
      'Request a new password reset link and use the latest email to continue.',
    sectionEyebrow: 'New password',
    heading: 'Reset password',
    subheading:
      'Use a password you have not used recently and keep it unique to your campus account.',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    newPasswordPlaceholder: 'Enter a new password',
    confirmPasswordPlaceholder: 'Confirm the new password',
    minimumHint: 'Minimum 8 characters.',
    savePassword: 'Saving new password',
    resetPassword: 'Reset password',
    successToast: 'Password reset complete',
    errors: {
      mismatch: 'The new password and confirmation must match.',
      tooShort: 'Choose a password with at least 8 characters.',
      fallback: 'We could not reset your password.',
    },
  },
  adminShell: {
    eyebrow: 'Admin workspace',
    signOut: 'Sign out',
    backToDashboard: 'Back to admin dashboard',
  },
  admin: {
    title: 'Admin dashboard',
    description:
      'Keep the campus workspace aligned across people, academics, finance, and reporting without leaving the admin shell.',
    managementConsoleTitle: 'Management console',
    managementConsoleDescription:
      'Jump straight into the workspace that needs attention. Each area keeps the same admin shell, confirmation flow, and route grammar.',
    menuItems: [
      ['User management', 'Review campus accounts, statuses, and role assignments.'],
      ['Lecturers', 'Manage lecturer records and academic ownership data.'],
      ['Courses', 'Maintain catalog structure, codes, and course metadata.'],
      ['Sections', 'Watch capacity, section ownership, and classroom attachment.'],
      ['Enrollments', 'Inspect registration outcomes and enrollment-level actions.'],
      ['Semesters', 'Control the academic timeline and current registration window.'],
      ['Departments', 'Manage departmental structure and faculty mappings.'],
      ['Classrooms', 'Track rooms, buildings, and capacity readiness.'],
      ['Analytics', 'Review operational reporting and top-level data health.'],
      ['Invoices', 'Handle tuition invoicing, balances, and payment review.'],
      ['Announcements', 'Publish updates that flow out to the rest of the campus.'],
    ],
    stats: ['Students', 'Lecturers', 'Courses', 'Enrollments'],
    statDetails: [
      'People records reachable through the current ownership model.',
      'Active lecturer accounts and teaching-facing identities.',
      'Catalog rows available for section planning and registration.',
      'Enrollment rows reflected across academic and analytics views.',
    ],
    loading: 'Loading campus overview',
    unavailableTitle: 'Admin overview unavailable',
    unavailableDescription: 'Campus overview is not available right now.',
  },
  adminAnalytics: {
    title: 'Reports and analytics',
    description:
      'Track enrollment volume, grading distribution, and classroom utilization without leaving the same admin grammar used across live record management.',
    overviewSectionTitle: 'Overview stats',
    refreshData: 'Refresh data',
    loading: 'Loading analytics overview',
    unavailableTitle: 'Analytics unavailable',
    unavailableDescription: 'Analytics data could not be loaded right now.',
    stats: [
      'Students',
      'Lecturers',
      'Courses',
      'Sections',
      'Enrollments',
      'Departments',
      'Faculties',
      'Classrooms',
    ],
    statDetails: [
      'Active student records in the current analytics snapshot.',
      'Teaching-facing identities available to academic operations.',
      'Catalog rows currently feeding sections and registration.',
      'Live section records currently visible to reporting.',
      'Enrollment throughput reflected across academic reporting.',
      'Department records tied to faculty and staffing views.',
      'Faculty groupings available for academic segmentation.',
      'Rooms currently available for section occupancy tracking.',
    ],
    panels: {
      enrollmentsBySemester: {
        title: 'Enrollments by semester',
        description:
          'Compare academic terms by current enrollment volume without leaving the reporting workspace.',
        emptyTitle: 'No semester enrollment data yet',
        emptyDescription:
          'Once enrollment rows are available, this panel will show which academic terms are carrying the most volume.',
      },
      gradeDistribution: {
        title: 'Grade distribution',
        description:
          'Watch published grades settle across the current academic workload.',
        emptyTitle: 'No published grades yet',
        emptyDescription:
          'This panel becomes more useful as sections publish final grades.',
      },
      sectionOccupancy: {
        title: 'Section occupancy',
        description:
          'Surface the sections that are close to capacity before they become an operational problem.',
        emptyTitle: 'No section occupancy data',
        emptyDescription:
          'Section and enrollment counts need to be present before occupancy can be visualized.',
      },
      enrollmentTrends: {
        title: 'Enrollment trends',
        description:
          'Review monthly intake, completions, and drop activity in one operational readout.',
        emptyTitle: 'No recent trend data',
        emptyDescription:
          'Trend cards appear when monthly enrollment activity is available.',
      },
    },
    tableHeaders: {
      course: 'Course',
      section: 'Section',
      semester: 'Semester',
      capacity: 'Capacity',
      enrolled: 'Enrolled',
      occupancy: 'Occupancy',
      students: 'students',
      grades: {
        enrolled: 'Enrolled',
        completed: 'Completed',
        dropped: 'Dropped',
      },
    },
  },
  dashboardShell: {
    roles: {
      student: 'Student access',
      lecturer: 'Lecturer access',
      admin: 'Admin access',
    },
    roleDescription:
      'Keep your next action close without losing the surrounding context.',
    menu: {
      dashboard: 'Dashboard',
      courseRegistration: 'Course registration',
      myCourses: 'My courses',
      schedule: 'Schedule',
      grades: 'Grades',
      transcript: 'Transcript',
      invoices: 'Invoices',
      announcements: 'Announcements',
      teachingSchedule: 'Teaching schedule',
      gradeManagement: 'Grade management',
      profileSettings: 'Profile settings',
      profile: 'Profile',
      settings: 'Settings',
    },
    notifications: {
      title: 'Notifications',
      loading: 'Loading recent alerts...',
      empty:
        'No unread alerts right now. Announcements remain the main broadcast channel for shared updates.',
      fallbackTitle: 'New update',
      fallbackContent: 'A new notification has arrived for your account.',
      openAnnouncements: 'Open announcements',
    },
    controls: {
      openSidebar: 'Open sidebar navigation',
      closeSidebar: 'Close sidebar navigation',
      closeOverlay: 'Close sidebar overlay',
      toggleNotifications: 'Toggle notifications panel',
      toggleProfile: 'Toggle profile menu',
    },
    pageDefaults: {
      description:
        'Navigate the current workflow without leaving the workspace shell.',
      title: 'Campus workspace',
      fallbackDescription:
        'Move through your current role surface with consistent session handling.',
    },
    routeDescriptions: {
      dashboard:
        'Registration, coursework, billing, and profile tasks stay in one student shell.',
      profile:
        'Keep contact details and credential rotation aligned with the active browser session.',
      register:
        'Browse sections and manage enrollment decisions for the current term.',
      enrollments:
        'Track the classes you are taking and the sections attached to them.',
      schedule:
        'Keep the weekly class view close while the rest of the portal stays reachable.',
      grades: 'Review published grades and current academic standing.',
      transcript: 'View cumulative academic history and semester outcomes.',
      invoices: 'Review billing status and payment history.',
      announcements: 'Read campus-wide updates and shared notices.',
      lecturer:
        'Keep teaching tasks, grading queues, section context, and announcements in one lecturer shell.',
      lecturerSchedule: 'Track assigned sections, rooms, and meeting windows.',
      lecturerGrades:
        'Review grading queues, filter by term, and move publish-ready sections forward.',
      lecturerAnnouncements:
        'Share updates with the students connected to your sections.',
    },
    loading: 'Loading workspace',
  },
  studentDashboard: {
    eyebrow: 'Student workspace',
    title: 'Welcome back, {name}',
    description:
      'The current term is {semester}. Move between registration, coursework, billing, and profile updates without leaving the student shell.',
    currentTermFallback: 'No active term',
    currentDateLabel: 'Today',
    metrics: {
      coursesInScope: 'Courses in scope',
      confirmedEnrollments: 'Confirmed enrollments',
      pendingDecisions: 'Pending decisions',
      currentSemester: 'Current semester',
      details: [
        'Registration, section context, and current coursework remain visible from the same student shell.',
        'Confirmed sections stay close so you can move into schedules, grades, and transcript work without losing context.',
        'Anything that still needs attention stays visible before it turns into a registration surprise.',
        'The dashboard keeps one active academic context so the rest of the student tools stay aligned.',
      ],
    },
    panels: {
      nextActions: {
        title: 'Next actions',
        description:
          'Open the student tools that usually need attention first during the current term.',
      },
      currentCourses: {
        title: 'Current courses',
        description:
          'Confirmed enrollments stay visible here so you can check course context before moving deeper into the workspace.',
        emptyTitle: 'No confirmed courses yet',
        emptyDescription:
          'Once enrollment is confirmed, your current courses will appear here.',
        sectionLabel: 'Section {section}',
      },
      referenceLinks: {
        title: 'Reference links',
        description:
          'Keep the supporting student views close without leaving the same session-backed shell.',
      },
      currentStatus: {
        title: 'Current status',
        description:
          'A quick read on the active academic context and any follow-up that still needs attention.',
        semesterSelectionTitle: 'Semester selection',
        semesterSelectionActive:
          'The dashboard is using {semester} for the current academic context.',
        semesterSelectionEmpty: 'No preferred semester is active yet.',
        enrollmentHealthTitle: 'Enrollment health',
        enrollmentHealthPending:
          '{count} registration item(s) still need attention.',
        enrollmentHealthClear:
          'No pending registration issues are blocking the current view.',
      },
    },
    quickActions: [
      ['Register courses', 'Browse available sections and make enrollment decisions.'],
      ['Open schedule', 'Check what is on the calendar this week.'],
      ['Review grades', 'See published results and academic standing.'],
      ['Check invoices', 'Keep track of outstanding balances and payment status.'],
    ],
    portalLinks: [
      ['My courses', 'Current registrations, section details, and status.'],
      ['Transcript', 'Semester history and cumulative academic outcomes.'],
      ['Announcements', 'Shared updates from the university and course teams.'],
    ],
    errors: {
      loadFailed: 'Your dashboard data could not be loaded.',
      unavailableTitle: 'Dashboard unavailable',
      loading: 'Loading dashboard',
    },
  },
  profile: {
    eyebrow: 'Account settings',
    title: 'Profile settings',
    description:
      'Update personal details, keep contact information current, and rotate credentials without leaving the workspace shell.',
    profileTitle: 'Account profile',
    profileDescription:
      'Keep the account record aligned with the information your campus teams rely on.',
    profileUpdated: 'Profile updated',
    profileSaveFailed: 'We could not save your profile changes.',
    passwordTitle: 'Password and session safety',
    passwordDescription:
      'Use a strong password and expect to sign in again after a successful change.',
    passwordUpdated: 'Password updated',
    passwordUpdateFailed: 'We could not update your password.',
    whatChangesTitle: 'What changes here',
    whatChanges: [
      'Profile edits update the browser session view after a successful save.',
      'Password rotation stays on the same authenticated route and uses the shared auth contract.',
      'Sensitive account ownership fields, such as your email, stay controlled by the service owner instead of an inline edit field.',
    ],
    fields: {
      firstName: 'First name',
      lastName: 'Last name',
      email: 'Email',
      phone: 'Phone',
      dateOfBirth: 'Date of birth',
      address: 'Address',
      currentPassword: 'Current password',
      newPassword: 'New password',
      confirmNewPassword: 'Confirm new password',
      managedHint: 'Email is managed through your campus account owner.',
      phonePlaceholder: '+66...',
      addressPlaceholder: 'Street, city, region',
      currentPasswordPlaceholder: 'Enter your current password',
      newPasswordPlaceholder: 'Choose a new password',
      confirmNewPasswordPlaceholder: 'Confirm the new password',
      passwordHint: 'Minimum 8 characters. Use something unique to this account.',
    },
    errors: {
      mismatch: 'The new password and confirmation must match.',
      tooShort: 'Choose a password with at least 8 characters.',
    },
    buttons: {
      savingChanges: 'Saving changes',
      updatingPassword: 'Updating password',
    },
  },
  lecturerDashboard: {
    eyebrow: 'Lecturer workspace',
    title: 'Welcome back, {name}',
    description:
      'Keep section operations, grading queues, and teaching updates in one lecturer-focused shell.',
    quickActionsTitle: 'Quick actions',
    quickActionsDescription:
      'Open the lecturer tools that usually drive the next teaching action.',
    gradingQueueTitle: 'Grading queue',
    gradingQueueDescription:
      'Sections nearest to final review stay visible here so grading work remains the primary next step.',
    gradingQueueEmptyTitle: 'No grading assignments',
    gradingQueueEmptyDescription:
      'Teaching sections with grading responsibility will appear here once they are active.',
    sectionsInScopeTitle: 'Sections in scope',
    sectionsInScopeDescription:
      'Assigned sections stay visible with capacity and department context before you move into schedule or grading detail.',
    sectionsInScopeEmptyTitle: 'No teaching assignments yet',
    sectionsInScopeEmptyDescription:
      'Assigned sections will appear here as soon as the current term is configured.',
    announcementsTitle: 'Latest announcements',
    announcementsDescription:
      'Broadcast updates that affect teaching operations surface here without taking the page away from the current workload.',
    announcementsEmptyTitle: 'No new notices',
    announcementsEmptyDescription:
      'Shared notices for the lecturer workspace will show up here once they are published.',
    quickLinks: [
      ['Teaching schedule', 'Check rooms, sections, and meeting times for the current term.'],
      ['Grade management', 'Finish grading queues and move publish-ready sections forward.'],
      ['Announcements', 'Review broadcast updates that affect your sections and teaching day.'],
    ],
    metrics: {
      labels: ['Sections', 'Students', 'Ready to publish', 'Fresh notices'],
      details: [
        'Assigned teaching sections stay visible so grading and scheduling decisions remain grounded in the same term context.',
        'Enrollment volume stays close to the lecturer shell so section-level follow-up remains visible.',
        'Publish-ready grading work surfaces early so final review does not get lost behind the rest of the workflow.',
        'Broadcast updates that affect teaching operations remain visible without pulling attention away from the grading queue.',
      ],
    },
    queueStatusReady: 'Ready to publish',
    queueStatusProgress: 'In progress',
    studentsSuffix: 'students',
    gradedSuffix: 'graded',
    errors: {
      loadFailed: 'The lecturer dashboard could not load its operational data.',
      unavailableTitle: 'Lecturer dashboard unavailable',
      loading: 'Loading lecturer dashboard',
    },
  },
  lecturerGrades: {
    eyebrow: 'Lecturer workspace',
    title: 'Grade management',
    description:
      'Track grading progress for {semester}, then move publish-ready sections into the final review step.',
    allSemesters: 'all semesters',
    allSemestersOption: 'All semesters',
    selectSemester: 'Select semester for grade management',
    queueTitle: 'Grade management queue',
    queueDescription:
      'Filter by semester, review section progress, and continue into the detail route that owns grade entry and publishing.',
    emptyTitle: 'No grading sections yet',
    emptyDescription:
      'Sections with grading responsibility will appear here once the teaching load is assigned.',
    labels: {
      sections: 'Sections',
      gradesCaptured: 'Grades captured',
      readyToPublish: 'Ready to publish',
      credits: 'credits',
      enrolled: 'enrolled',
      graded: 'graded',
      published: 'published',
      sectionPrefix: 'Section',
      readyStatus: 'Ready to publish',
      manageGrades: 'Manage grades',
      enterGrades: 'Enter grades',
    },
    details: [
      'Active grading responsibilities for the selected semester remain grouped in one queue.',
      'Recorded grade entries stay visible before you move any section to final publishing.',
      'Sections that can move into the final review step are highlighted without changing the grading contract.',
    ],
    errors: {
      loadFailed: 'Grade management data could not be loaded.',
      unavailableTitle: 'Grade management unavailable',
      loading: 'Loading grade management',
    },
  },
} as const;

type DeepWiden<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly DeepWiden<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepWiden<T[K]> }
      : T;

export type I18nMessages = DeepWiden<typeof en>;

export const vi: I18nMessages = {
  common: {
    locale: {
      label: 'Ngôn ngữ',
      english: 'Tiếng Anh',
      vietnamese: 'Tiếng Việt',
      switchToEnglish: 'Switch to English',
      switchToVietnamese: 'Chuyển sang tiếng Việt',
    },
    actions: {
      signIn: 'Đăng nhập',
      signOut: 'Đăng xuất',
      save: 'Lưu',
      saveChanges: 'Lưu thay đổi',
      cancel: 'Hủy',
      confirm: 'Xác nhận',
      retry: 'Thử lại',
      refresh: 'Làm mới dữ liệu',
      openTool: 'Mở công cụ',
      openView: 'Mở màn hình',
      openWorkspace: 'Mở workspace',
      returnHome: 'Quay về trang chủ',
      openDashboard: 'Mở dashboard',
      continueToWorkspace: 'Tiếp tục vào workspace',
      signInToWorkspace: 'Đăng nhập vào workspace',
      reviewAdmin: 'Mở khu quản trị',
      browseSections: 'Xem lớp học phần',
      clearFilters: 'Xóa bộ lọc',
      openAnalytics: 'Mở phân tích',
      addUser: 'Thêm người dùng',
      createUser: 'Tạo người dùng',
      search: 'Tìm kiếm',
      backToSignIn: 'Quay lại đăng nhập',
      requestNewResetLink: 'Yêu cầu liên kết mới',
      tryAnotherEmail: 'Thử email khác',
      updatePassword: 'Cập nhật mật khẩu',
      reviewProfileSettings: 'Xem cài đặt hồ sơ',
      openAnnouncements: 'Mở thông báo',
    },
    states: {
      loadingContent: 'Đang tải nội dung',
      loading: 'Đang tải...',
      closeModal: 'Đóng hộp thoại',
      goToPreviousPage: 'Trang trước',
      goToNextPage: 'Trang sau',
      searchPlaceholder: 'Tìm kiếm...',
      export: 'Xuất dữ liệu',
      noDataFound: 'Không có dữ liệu',
      showingResults: 'Hiển thị',
      to: 'đến',
      of: 'trên',
      results: 'kết quả',
      page: 'Trang',
      perPage10: '10 dòng / trang',
      perPage25: '25 dòng / trang',
      perPage50: '50 dòng / trang',
      perPage100: '100 dòng / trang',
    },
  },
  meta: {
    defaults: {
      siteName: 'CampusCore',
      title: 'Workspace vận hành campus',
      description:
        'CampusCore là workspace vận hành campus cho định danh, học vụ, tài chính, tương tác, dữ liệu con người và phân tích.',
      ogAlt: 'Tổng quan workspace CampusCore',
      twitterTitle: 'CampusCore',
      twitterDescription:
        'Workspace vận hành campus cho học vụ, tài chính, tương tác, phân tích và phiên trình duyệt an toàn.',
    },
    home: {
      title: 'Workspace vận hành campus',
      description:
        'CampusCore mang đến một workspace ổn định cho đội vận hành, giảng viên và sinh viên, đồng thời giữ ranh giới rõ ràng giữa auth, học vụ, tài chính, phân tích và dữ liệu con người.',
    },
    login: {
      title: 'Đăng nhập',
      description: 'Đăng nhập CampusCore bằng tài khoản campus của bạn.',
    },
    forgotPassword: {
      title: 'Quên mật khẩu',
      description: 'Yêu cầu liên kết đặt lại mật khẩu CampusCore.',
    },
    resetPassword: {
      title: 'Đặt lại mật khẩu',
      description: 'Tạo mật khẩu mới cho CampusCore và quay lại workspace.',
    },
    dashboard: {
      title: 'Workspace',
      description:
        'Các dashboard được bảo vệ cho sinh viên và giảng viên trong CampusCore.',
    },
    admin: {
      title: 'Workspace quản trị',
      description: 'Các route quản trị được bảo vệ của CampusCore.',
    },
    socialImage: {
      eyebrow: 'CampusCore',
      title: 'Vận hành campus vẫn vững dưới tải thực tế.',
      description:
        'Định danh, học vụ, tài chính, tương tác, dữ liệu con người và phân tích trong một workspace đã được xác minh phát hành.',
      badges: [
        'Cookie session + CSRF',
        'Topology 9 image',
        'Compose + Kubernetes',
      ],
    },
  },
  home: {
    navSubtitle: 'Workspace vận hành campus',
    eyebrow: 'Nền tảng CampusCore',
    title: 'Vận hành học vụ ổn định, không chắp vá.',
    description:
      'CampusCore gom định danh, học vụ, tài chính, tương tác, dữ liệu con người và phân tích vào một workspace web duy nhất, đồng thời vẫn giữ rõ owner dịch vụ, kiểm chứng phát hành và ranh giới runtime.',
    metricCards: [
      {
        title: 'Sẵn sàng cho Kubernetes',
        description:
          'Luồng Docker Desktop local và Kustomize đã xác minh theo release luôn đi cùng nhau.',
      },
      {
        title: 'Ưu tiên bảo mật',
        description:
          'Refresh phiên, header CSRF và chặn internal edge vẫn được giữ nguyên.',
      },
      {
        title: 'Vận hành rõ ràng',
        description:
          'UI bám theo owner rõ ràng thay vì dồn tất cả trở lại một lõi duy nhất.',
      },
    ],
    snapshotEyebrow: 'Ảnh chụp runtime',
    snapshotTitle: 'Phát hành đã được xác minh mà không che đi phần chuyển động bên dưới',
    snapshotChecks: [
      'Auth, analytics, finance, academic, engagement và people tách owner riêng',
      'Frontend Next.js với cookie session refresh và mutation an toàn với CSRF',
      'Xác minh runtime theo Compose và Kubernetes trước',
      'Public edge vẫn chặn contract nội bộ khỏi trình duyệt',
    ],
    snapshotPrimaryAccessTitle: 'Lối vào chính',
    snapshotPrimaryAccessDescription:
      'Sinh viên, giảng viên và quản trị cùng đi qua một contract trình duyệt nhất quán.',
    snapshotReleaseTitle: 'Trạng thái phát hành',
    snapshotReleaseDescription:
      'Registry publishing, kiểm image và K8s local vẫn truy vết được rõ ràng.',
    capabilitiesEyebrow: 'Portal này được xây để làm gì',
    capabilitiesTitle: 'Một ngôn ngữ giao diện cho các luồng campus quan trọng',
    capabilitiesDescription:
      'Giao diện được thiết kế cho vận hành campus thực tế, với mặc định điềm tĩnh hơn cho auth, data state và tác vụ theo role.',
    pillars: [
      {
        title: 'Định danh đáng tin',
        description:
          'Cookie session, CSRF protection và role-aware routing luôn được giữ vững trong web client.',
      },
      {
        title: 'Luồng học vụ',
        description:
          'Đăng ký, thời khóa biểu, điểm, bảng điểm và vận hành section nằm sau các ranh giới dịch vụ rõ ràng.',
      },
      {
        title: 'Quan sát vận hành',
        description:
          'Dashboard và báo cáo đi theo owner analytics thay vì rò rỉ qua các domain không liên quan.',
      },
      {
        title: 'Owner dữ liệu con người',
        description:
          'Dữ liệu sinh viên và giảng viên vẫn hiển thị trên frontend mà không kéo UI trở lại monolith.',
      },
      {
        title: 'Kỷ luật phát hành',
        description:
          'Compose, Kustomize, CI, registry publishing và edge check cùng trỏ về một topology 9 image.',
      },
      {
        title: 'Portal sẵn cho campus',
        description:
          'Một cổng chung cho sinh viên, giảng viên và quản trị với state rõ hơn, ít ngõ cụt hơn và điều hướng điềm tĩnh hơn.',
      },
    ],
    whyEyebrow: 'Vì sao CampusCore chọn microservices',
    whyTitle: 'Tách owner đúng nơi vận hành campus thực sự đã tách',
    whyDescription:
      'CampusCore đi theo hướng microservices vì vận hành campus không hỏng đồng loạt trong một lần. Định danh, học vụ, tài chính, tương tác, dữ liệu con người và phân tích vận hành với nhịp độ khác nhau và cần các đường phát hành khác nhau.',
    whyPoints: [
      {
        title: 'Giảm blast radius',
        description:
          'Một lỗi nhập điểm không nên kéo tài chính xuống, và thay đổi billing không nên chặn đăng nhập.',
      },
      {
        title: 'Auth có owner độc lập',
        description:
          'Định danh và browser session được giữ trọn trong auth thay vì rải vào các service không liên quan.',
      },
      {
        title: 'Scale theo tải',
        description:
          'Analytics, announcements và luồng enrollment có thể scale riêng mà không kéo cả hệ thống theo.',
      },
      {
        title: 'Kiểm chứng phát hành rõ',
        description:
          'Topology 9 image giúp truy dấu thứ gì đã publish, đã verify và đang chạy dễ hơn.',
      },
      {
        title: 'Ranh giới edge mạnh hơn',
        description:
          'Route công khai vẫn dễ dùng cho trình duyệt trong khi contract nội bộ ở phía sau edge.',
      },
      {
        title: 'Bàn giao vận hành rõ hơn',
        description:
          'Compose, Kustomize và kiểm chứng registry dễ đọc hơn vì mỗi domain sở hữu một bề mặt nhỏ hơn.',
      },
    ],
    footerSubtitle: 'Workspace vận hành',
    footerDescription:
      'Nền tảng campus theo hướng microservices, tập trung vào browser auth ổn định, owner dịch vụ rõ ràng và runtime đã được xác minh.',
    footerWorkspace: 'Workspace',
    footerDelivery: 'Triển khai',
    footerLinks: {
      workspace: ['Khu sinh viên', 'Luồng giảng viên', 'Vận hành quản trị'],
      delivery: ['Compose và K8s', 'Phát hành image theo semver', 'Kiểm edge và bảo mật'],
    },
    footerCopyright: 'Mọi quyền được bảo lưu.',
  },
  authShell: {
    mobileSubtitle: 'Truy cập học vụ',
  },
  login: {
    eyebrow: 'Truy cập an toàn',
    title: 'Đăng nhập vào workspace campus.',
    description:
      'Dùng cùng một browser session đã được bảo vệ để di chuyển giữa học vụ, tài chính, thông báo và dashboard vận hành.',
    featureTitles: ['Theo role đúng chỗ', 'Bảo vệ phiên', 'Luồng vận hành liên tục'],
    featureDescriptions: [
      'Quản trị, giảng viên và sinh viên vào đúng workspace mà không cần bước đăng nhập thứ hai.',
      'Auth trên trình duyệt vẫn dùng cookie session với CSRF protection và refresh handling.',
      'Các luồng học vụ, tài chính, tương tác và phân tích luôn đi qua cùng một portal.',
    ],
    sectionEyebrow: 'Truy cập tài khoản',
    heading: 'Chào mừng bạn quay lại',
    subheading: 'Đăng nhập bằng tài khoản campus để tiếp tục.',
    emailLabel: 'Địa chỉ email',
    emailPlaceholder: 'you@university.edu',
    passwordLabel: 'Mật khẩu',
    passwordPlaceholder: 'Nhập mật khẩu của bạn',
    forgotPassword: 'Quên mật khẩu?',
    showPassword: 'Hiện mật khẩu',
    hidePassword: 'Ẩn mật khẩu',
    signingIn: 'Đang đăng nhập',
    sessionBehaviorTitle: 'Cách phiên hoạt động',
    sessionBehaviorDescription:
      'CampusCore dùng browser session dựa trên cookie với refresh tự động và CSRF protection cho các request thay đổi dữ liệu.',
    reasonMessages: {
      sessionExpired: {
        title: 'Phiên của bạn đã kết thúc',
        body: 'Hãy đăng nhập lại để tiếp tục làm việc trong CampusCore.',
      },
      unauthorized: {
        title: 'Cần đăng nhập',
        body: 'Yêu cầu trước đó cần một phiên đang hoạt động.',
      },
      signedOut: {
        title: 'Đã đăng xuất',
        body: 'Bạn đã được đăng xuất khỏi workspace.',
      },
    },
    runtimeNotice: {
      infoTitle: 'Bản xem trước cho phát triển',
      infoBody:
        'Frontend local này đang đi qua edge proxy. Nếu đăng nhập ngừng phản hồi, hãy bật local edge helper hoặc dùng domain public.',
      warningTitle: 'Local edge chưa sẵn sàng',
      warningBody:
        'Bản preview này chưa chạm được local edge. Hãy bật edge helper tại {origin} hoặc dùng domain public thay vì dựa vào chế độ preview chỉ có frontend.',
    },
    errors: {
      fallback: 'Hiện chưa thể đăng nhập.',
      invalidCredentials: 'Email hoặc mật khẩu không đúng.',
      blocked: 'Lần đăng nhập này đã bị chặn. Hãy làm mới trang rồi thử lại.',
      backendUnavailable:
        'CampusCore chưa chạm được local edge hoặc auth service. Hãy bật edge helper, kiểm tra proxy target đang khỏe, hoặc dùng domain public.',
      temporaryUnavailable:
        'Đăng nhập tạm thời chưa sẵn sàng. Vui lòng thử lại sau ít phút.',
    },
    returnHomeLead: 'Cần một điểm vào khác?',
  },
  forgotPassword: {
    eyebrow: 'Khôi phục mật khẩu',
    title: 'Lấy lại quyền truy cập mà không cần đoán mò.',
    description:
      'Dùng email campus để yêu cầu liên kết đặt lại mật khẩu. Phản hồi sẽ giữ nhất quán dù tài khoản có tồn tại hay không.',
    featureTitles: ['Bàn giao đã xác minh', 'Bước kế tiếp rõ ràng', 'Thông điệp an toàn hơn'],
    featureDescriptions: [
      'Khôi phục mật khẩu vẫn nằm trong cùng browser contract với đăng nhập và refresh phiên.',
      'Màn hình luôn giữ hướng dẫn khôi phục hiển thị thay vì đưa bạn vào ngõ cụt.',
      'Phản hồi được giữ mơ hồ có chủ đích để không xác nhận email có tồn tại hay không.',
    ],
    sectionEyebrow: 'Luồng khôi phục',
    heading: 'Quên mật khẩu',
    beforeSend: 'Nhập email của bạn và chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.',
    afterSend: 'Bước tiếp theo đang ở trong hộp thư email của bạn.',
    emailLabel: 'Địa chỉ email',
    emailPlaceholder: 'you@university.edu',
    emailHint: 'Dùng địa chỉ được gắn với tài khoản campus của bạn.',
    sendResetLink: 'Gửi liên kết đặt lại',
    sendingResetInstructions: 'Đang gửi hướng dẫn đặt lại',
    sentToast: 'Nếu email tồn tại, một liên kết đặt lại đã được gửi.',
    failedToast: 'Hiện chưa thể bắt đầu khôi phục mật khẩu.',
    sentBanner:
      'Nếu có tài khoản khớp với {email}, một liên kết đặt lại đang được gửi đi.',
    sentDescription:
      'Hãy kiểm tra cả thư rác hoặc quảng cáo nếu chưa thấy thư ngay. Bạn cũng có thể bắt đầu lại với email khác.',
  },
  resetPassword: {
    eyebrow: 'Đặt lại mật khẩu',
    title: 'Tạo mật khẩu mới và quay lại CampusCore.',
    description:
      'Chọn mật khẩu mới cho tài khoản campus của bạn. Sau khi xong, bạn sẽ đăng nhập lại bằng thông tin vừa cập nhật.',
    featureTitles: ['Một đường đi an toàn', 'Yêu cầu rõ ràng', 'Khôi phục nhất quán'],
    featureDescriptions: [
      'Reset token quay lại cùng luồng đăng nhập được bảo vệ thay vì tách ra thành một trải nghiệm khác.',
      'Người dùng thấy yêu cầu mật khẩu và kiểm tra hợp lệ trước khi gửi form.',
      'Token hết hạn hoặc không hợp lệ vẫn hiển thị trạng thái khôi phục ổn định thay vì một trang lỗi.',
    ],
    invalidTitle: 'Liên kết đặt lại này không còn hợp lệ',
    invalidDescription:
      'Hãy yêu cầu một liên kết đặt lại mật khẩu mới và dùng email mới nhất để tiếp tục.',
    sectionEyebrow: 'Mật khẩu mới',
    heading: 'Đặt lại mật khẩu',
    subheading:
      'Hãy dùng mật khẩu bạn chưa dùng gần đây và giữ nó là duy nhất cho tài khoản campus của bạn.',
    newPassword: 'Mật khẩu mới',
    confirmPassword: 'Xác nhận mật khẩu',
    newPasswordPlaceholder: 'Nhập mật khẩu mới',
    confirmPasswordPlaceholder: 'Xác nhận mật khẩu mới',
    minimumHint: 'Tối thiểu 8 ký tự.',
    savePassword: 'Đang lưu mật khẩu mới',
    resetPassword: 'Đặt lại mật khẩu',
    successToast: 'Đặt lại mật khẩu thành công',
    errors: {
      mismatch: 'Mật khẩu mới và phần xác nhận phải trùng nhau.',
      tooShort: 'Hãy chọn mật khẩu có ít nhất 8 ký tự.',
      fallback: 'Hiện chưa thể đặt lại mật khẩu.',
    },
  },
  adminShell: {
    eyebrow: 'Workspace quản trị',
    signOut: 'Đăng xuất',
    backToDashboard: 'Quay lại dashboard quản trị',
  },
  admin: {
    title: 'Dashboard quản trị',
    description:
      'Giữ workspace campus nhất quán giữa dữ liệu con người, học vụ, tài chính và báo cáo mà không rời khỏi admin shell.',
    managementConsoleTitle: 'Bảng điều hướng quản trị',
    managementConsoleDescription:
      'Đi thẳng vào khu cần xử lý. Mỗi khu vẫn dùng cùng admin shell, confirmation flow và route grammar.',
    menuItems: [
      ['Quản lý người dùng', 'Xem tài khoản campus, trạng thái và phân quyền.'],
      ['Giảng viên', 'Quản lý hồ sơ giảng viên và dữ liệu sở hữu học vụ.'],
      ['Môn học', 'Duy trì danh mục, mã môn và metadata môn học.'],
      ['Lớp học phần', 'Theo dõi sức chứa, owner của section và phòng học đi kèm.'],
      ['Đăng ký học', 'Kiểm tra kết quả đăng ký và các tác vụ ở mức enrollment.'],
      ['Học kỳ', 'Kiểm soát dòng thời gian học vụ và cửa sổ đăng ký hiện tại.'],
      ['Bộ môn', 'Quản lý cấu trúc bộ môn và ánh xạ khoa.'],
      ['Phòng học', 'Theo dõi phòng, tòa nhà và mức sẵn sàng về sức chứa.'],
      ['Phân tích', 'Xem báo cáo vận hành và sức khỏe dữ liệu ở mức tổng quan.'],
      ['Hóa đơn', 'Xử lý học phí, số dư và đối soát thanh toán.'],
      ['Thông báo', 'Phát hành cập nhật ra toàn campus.'],
    ],
    stats: ['Sinh viên', 'Giảng viên', 'Môn học', 'Đăng ký học'],
    statDetails: [
      'Bản ghi con người có thể truy cập theo mô hình owner hiện tại.',
      'Tài khoản giảng viên đang hoạt động và danh tính phục vụ giảng dạy.',
      'Các dòng catalog sẵn sàng cho hoạch định section và đăng ký.',
      'Các dòng enrollment đã phản ánh vào góc nhìn học vụ và analytics.',
    ],
    loading: 'Đang tải tổng quan campus',
    unavailableTitle: 'Tổng quan quản trị chưa sẵn sàng',
    unavailableDescription: 'Hiện chưa thể tải tổng quan campus.',
  },
  adminAnalytics: {
    title: 'Báo cáo và phân tích',
    description:
      'Theo dõi lưu lượng enrollment, phân bố điểm và sử dụng phòng học mà vẫn ở trong cùng admin grammar dùng cho quản trị dữ liệu sống.',
    overviewSectionTitle: 'Chỉ số tổng quan',
    refreshData: 'Làm mới dữ liệu',
    loading: 'Đang tải tổng quan phân tích',
    unavailableTitle: 'Phân tích chưa sẵn sàng',
    unavailableDescription: 'Hiện chưa thể tải dữ liệu phân tích.',
    stats: [
      'Sinh viên',
      'Giảng viên',
      'Môn học',
      'Section',
      'Enrollment',
      'Bộ môn',
      'Khoa',
      'Phòng học',
    ],
    statDetails: [
      'Bản ghi sinh viên đang hoạt động trong snapshot analytics hiện tại.',
      'Danh tính hướng giảng dạy hiện sẵn sàng cho vận hành học vụ.',
      'Các dòng catalog đang cấp dữ liệu cho section và đăng ký.',
      'Các bản ghi section trực tiếp hiện hiển thị trong reporting.',
      'Lưu lượng enrollment đang được phản ánh xuyên suốt các báo cáo học vụ.',
      'Bản ghi bộ môn gắn với góc nhìn khoa và nhân sự.',
      'Các nhóm khoa đang sẵn sàng cho phân đoạn học vụ.',
      'Các phòng hiện sẵn sàng cho việc theo dõi mức đầy của section.',
    ],
    panels: {
      enrollmentsBySemester: {
        title: 'Đăng ký theo học kỳ',
        description:
          'So sánh các học kỳ theo lưu lượng đăng ký hiện tại mà không rời màn hình báo cáo.',
        emptyTitle: 'Chưa có dữ liệu đăng ký theo học kỳ',
        emptyDescription:
          'Khi có dữ liệu enrollment, khối này sẽ cho biết học kỳ nào đang mang nhiều lưu lượng nhất.',
      },
      gradeDistribution: {
        title: 'Phân bố điểm',
        description:
          'Theo dõi cách điểm số đã công bố đang phân bổ theo khối lượng học vụ hiện tại.',
        emptyTitle: 'Chưa có điểm đã công bố',
        emptyDescription:
          'Khối này sẽ hữu ích hơn khi các section bắt đầu publish điểm cuối kỳ.',
      },
      sectionOccupancy: {
        title: 'Mức đầy của section',
        description:
          'Đưa các section gần đầy lên sớm trước khi chúng trở thành vấn đề vận hành.',
        emptyTitle: 'Chưa có dữ liệu mức đầy',
        emptyDescription:
          'Cần có số lượng section và enrollment trước khi hiển thị được mức đầy.',
      },
      enrollmentTrends: {
        title: 'Xu hướng enrollment',
        description:
          'Xem intake hàng tháng, completion và drop trong một màn đọc vận hành thống nhất.',
        emptyTitle: 'Chưa có dữ liệu xu hướng gần đây',
        emptyDescription:
          'Các thẻ xu hướng sẽ xuất hiện khi có hoạt động enrollment theo tháng.',
      },
    },
    tableHeaders: {
      course: 'Môn học',
      section: 'Section',
      semester: 'Học kỳ',
      capacity: 'Sức chứa',
      enrolled: 'Đã đăng ký',
      occupancy: 'Mức đầy',
      students: 'sinh viên',
      grades: {
        enrolled: 'Đăng ký',
        completed: 'Hoàn tất',
        dropped: 'Rút môn',
      },
    },
  },
  dashboardShell: {
    roles: {
      student: 'Truy cập sinh viên',
      lecturer: 'Truy cập giảng viên',
      admin: 'Truy cập quản trị',
    },
    roleDescription:
      'Giữ tác vụ kế tiếp trong tầm tay mà không làm mất ngữ cảnh xung quanh.',
    menu: {
      dashboard: 'Dashboard',
      courseRegistration: 'Đăng ký học phần',
      myCourses: 'Môn học của tôi',
      schedule: 'Thời khóa biểu',
      grades: 'Điểm số',
      transcript: 'Bảng điểm',
      invoices: 'Hóa đơn',
      announcements: 'Thông báo',
      teachingSchedule: 'Lịch giảng dạy',
      gradeManagement: 'Quản lý điểm',
      profileSettings: 'Cài đặt hồ sơ',
      profile: 'Hồ sơ',
      settings: 'Cài đặt',
    },
    notifications: {
      title: 'Thông báo',
      loading: 'Đang tải các cảnh báo gần đây...',
      empty:
        'Hiện chưa có cảnh báo chưa đọc. Thông báo vẫn là kênh broadcast chính cho các cập nhật dùng chung.',
      fallbackTitle: 'Cập nhật mới',
      fallbackContent: 'Tài khoản của bạn vừa nhận một thông báo mới.',
      openAnnouncements: 'Mở trang thông báo',
    },
    controls: {
      openSidebar: 'Mở điều hướng sidebar',
      closeSidebar: 'Đóng điều hướng sidebar',
      closeOverlay: 'Đóng lớp phủ sidebar',
      toggleNotifications: 'Bật tắt bảng thông báo',
      toggleProfile: 'Bật tắt menu hồ sơ',
    },
    pageDefaults: {
      description:
        'Đi giữa các bước hiện tại mà không rời khỏi workspace shell.',
      title: 'Workspace Campus',
      fallbackDescription:
        'Di chuyển trong bề mặt theo role hiện tại với contract phiên nhất quán.',
    },
    routeDescriptions: {
      dashboard:
        'Giữ đăng ký, môn học, hóa đơn và tác vụ hồ sơ trong cùng một student shell.',
      profile:
        'Giữ thông tin liên hệ và vòng đời thông tin xác thực khớp với phiên trình duyệt đang hoạt động.',
      register:
        'Xem các section và quản lý quyết định enrollment cho học kỳ hiện tại.',
      enrollments:
        'Theo dõi các môn đang học và section gắn với từng môn.',
      schedule:
        'Giữ góc nhìn thời khóa biểu theo tuần trong tầm tay khi phần còn lại của portal vẫn sẵn sàng.',
      grades: 'Xem điểm đã công bố và trạng thái học tập hiện tại.',
      transcript: 'Xem lịch sử học tập tích lũy và kết quả theo học kỳ.',
      invoices: 'Xem tình trạng hóa đơn và lịch sử thanh toán.',
      announcements: 'Đọc các cập nhật dùng chung trên toàn campus.',
      lecturer:
        'Giữ tác vụ giảng dạy, hàng chờ chấm điểm, ngữ cảnh section và thông báo trong cùng một lecturer shell.',
      lecturerSchedule: 'Theo dõi section được giao, phòng học và khung giờ lên lớp.',
      lecturerGrades:
        'Xem hàng chờ chấm điểm, lọc theo học kỳ và đẩy các section sẵn sàng sang bước publish.',
      lecturerAnnouncements:
        'Chia sẻ cập nhật với sinh viên đang gắn với các section của bạn.',
    },
    loading: 'Đang tải workspace',
  },
  studentDashboard: {
    eyebrow: 'Workspace sinh viên',
    title: 'Chào mừng quay lại, {name}',
    description:
      'Học kỳ hiện tại là {semester}. Di chuyển giữa đăng ký, môn học, hóa đơn và cập nhật hồ sơ mà không rời student shell.',
    currentTermFallback: 'Chưa có học kỳ hoạt động',
    currentDateLabel: 'Hôm nay',
    metrics: {
      coursesInScope: 'Môn học trong phạm vi',
      confirmedEnrollments: 'Đăng ký đã xác nhận',
      pendingDecisions: 'Mục chờ xử lý',
      currentSemester: 'Học kỳ hiện tại',
      details: [
        'Registration, section context và coursework hiện tại luôn ở cùng một student shell.',
        'Các section đã xác nhận ở gần để bạn chuyển qua schedule, grades và transcript mà không mất ngữ cảnh.',
        'Những mục còn cần xử lý vẫn hiển thị sớm trước khi thành bất ngờ trong đợt đăng ký.',
        'Dashboard giữ một ngữ cảnh học vụ đang hoạt động để các công cụ còn lại luôn đồng bộ.',
      ],
    },
    panels: {
      nextActions: {
        title: 'Bước tiếp theo',
        description:
          'Mở các công cụ sinh viên thường cần xử lý đầu tiên trong học kỳ hiện tại.',
      },
      currentCourses: {
        title: 'Môn học hiện tại',
        description:
          'Các enrollment đã xác nhận luôn nằm ở đây để bạn xem lại ngữ cảnh trước khi đi sâu hơn.',
        emptyTitle: 'Chưa có môn học đã xác nhận',
        emptyDescription:
          'Khi enrollment được xác nhận, các môn hiện tại sẽ xuất hiện tại đây.',
        sectionLabel: 'Section {section}',
      },
      referenceLinks: {
        title: 'Liên kết tham chiếu',
        description:
          'Giữ các màn hỗ trợ trong tầm tay mà vẫn ở trong cùng session-backed shell.',
      },
      currentStatus: {
        title: 'Trạng thái hiện tại',
        description:
          'Một góc nhìn nhanh về ngữ cảnh học vụ đang dùng và các việc còn cần chú ý.',
        semesterSelectionTitle: 'Lựa chọn học kỳ',
        semesterSelectionActive:
          'Dashboard đang dùng {semester} làm ngữ cảnh học vụ hiện tại.',
        semesterSelectionEmpty: 'Chưa có học kỳ ưu tiên nào đang hoạt động.',
        enrollmentHealthTitle: 'Sức khỏe enrollment',
        enrollmentHealthPending:
          'Vẫn còn {count} mục đăng ký cần được xử lý.',
        enrollmentHealthClear:
          'Không có vấn đề đăng ký nào đang chặn góc nhìn hiện tại.',
      },
    },
    quickActions: [
      ['Đăng ký học phần', 'Xem các section đang mở và đưa ra quyết định enrollment.'],
      ['Mở thời khóa biểu', 'Kiểm tra lịch học của tuần này.'],
      ['Xem điểm số', 'Xem kết quả đã công bố và tình trạng học tập.'],
      ['Kiểm tra hóa đơn', 'Theo dõi số dư chưa thanh toán và trạng thái thanh toán.'],
    ],
    portalLinks: [
      ['Môn học của tôi', 'Đăng ký hiện tại, chi tiết section và trạng thái.'],
      ['Bảng điểm', 'Lịch sử theo học kỳ và kết quả học tập tích lũy.'],
      ['Thông báo', 'Cập nhật chung từ trường và các nhóm học phần.'],
    ],
    errors: {
      loadFailed: 'Hiện chưa thể tải dữ liệu dashboard của bạn.',
      unavailableTitle: 'Dashboard chưa sẵn sàng',
      loading: 'Đang tải dashboard',
    },
  },
  profile: {
    eyebrow: 'Cài đặt tài khoản',
    title: 'Cài đặt hồ sơ',
    description:
      'Cập nhật thông tin cá nhân, giữ dữ liệu liên hệ mới nhất và xoay vòng thông tin xác thực mà không rời workspace shell.',
    profileTitle: 'Hồ sơ tài khoản',
    profileDescription:
      'Giữ hồ sơ tài khoản khớp với thông tin mà các nhóm campus đang dựa vào.',
    profileUpdated: 'Đã cập nhật hồ sơ',
    profileSaveFailed: 'Hiện chưa thể lưu thay đổi hồ sơ.',
    passwordTitle: 'Mật khẩu và an toàn phiên',
    passwordDescription:
      'Dùng mật khẩu mạnh và chờ đăng nhập lại sau khi đổi thành công.',
    passwordUpdated: 'Đã cập nhật mật khẩu',
    passwordUpdateFailed: 'Hiện chưa thể cập nhật mật khẩu.',
    whatChangesTitle: 'Những gì thay đổi ở đây',
    whatChanges: [
      'Chỉnh sửa hồ sơ sẽ cập nhật lại góc nhìn phiên trình duyệt sau khi lưu thành công.',
      'Đổi mật khẩu vẫn nằm trên cùng route đã xác thực và dùng chung auth contract.',
      'Các trường sở hữu nhạy cảm như email vẫn do service owner kiểm soát, không cho sửa trực tiếp trong form.',
    ],
    fields: {
      firstName: 'Tên',
      lastName: 'Họ',
      email: 'Email',
      phone: 'Số điện thoại',
      dateOfBirth: 'Ngày sinh',
      address: 'Địa chỉ',
      currentPassword: 'Mật khẩu hiện tại',
      newPassword: 'Mật khẩu mới',
      confirmNewPassword: 'Xác nhận mật khẩu mới',
      managedHint: 'Email do owner của tài khoản campus quản lý.',
      phonePlaceholder: '+66...',
      addressPlaceholder: 'Số nhà, thành phố, khu vực',
      currentPasswordPlaceholder: 'Nhập mật khẩu hiện tại',
      newPasswordPlaceholder: 'Chọn mật khẩu mới',
      confirmNewPasswordPlaceholder: 'Xác nhận mật khẩu mới',
      passwordHint: 'Tối thiểu 8 ký tự. Hãy dùng mật khẩu riêng cho tài khoản này.',
    },
    errors: {
      mismatch: 'Mật khẩu mới và phần xác nhận phải trùng nhau.',
      tooShort: 'Hãy chọn mật khẩu có ít nhất 8 ký tự.',
    },
    buttons: {
      savingChanges: 'Đang lưu thay đổi',
      updatingPassword: 'Đang cập nhật mật khẩu',
    },
  },
  lecturerDashboard: {
    eyebrow: 'Workspace giảng viên',
    title: 'Chào mừng quay lại, {name}',
    description:
      'Giữ vận hành section, hàng chờ chấm điểm và cập nhật giảng dạy trong cùng một lecturer shell.',
    quickActionsTitle: 'Tác vụ nhanh',
    quickActionsDescription:
      'Mở các công cụ giảng viên thường dẫn đến tác vụ tiếp theo trong ngày.',
    gradingQueueTitle: 'Hàng chờ chấm điểm',
    gradingQueueDescription:
      'Các section gần bước rà soát cuối luôn ở đây để việc chấm điểm vẫn là ưu tiên chính.',
    gradingQueueEmptyTitle: 'Chưa có phân công chấm điểm',
    gradingQueueEmptyDescription:
      'Các section có trách nhiệm chấm điểm sẽ xuất hiện tại đây khi được kích hoạt.',
    sectionsInScopeTitle: 'Các section trong phạm vi',
    sectionsInScopeDescription:
      'Các section được giao luôn hiển thị cùng sức chứa và ngữ cảnh bộ môn trước khi bạn đi sâu vào lịch hoặc chấm điểm.',
    sectionsInScopeEmptyTitle: 'Chưa có phân công giảng dạy',
    sectionsInScopeEmptyDescription:
      'Các section được giao sẽ xuất hiện tại đây ngay khi học kỳ hiện tại được cấu hình.',
    announcementsTitle: 'Thông báo mới nhất',
    announcementsDescription:
      'Các cập nhật ảnh hưởng đến giảng dạy được đưa lên đây mà không làm bạn rời khỏi khối lượng công việc hiện tại.',
    announcementsEmptyTitle: 'Chưa có thông báo mới',
    announcementsEmptyDescription:
      'Các thông báo chung cho workspace giảng viên sẽ xuất hiện ở đây sau khi được phát hành.',
    quickLinks: [
      ['Lịch giảng dạy', 'Kiểm tra phòng học, section và thời gian dạy của học kỳ hiện tại.'],
      ['Quản lý điểm', 'Xử lý hàng chờ chấm điểm và đẩy các section đã sẵn sàng sang bước publish.'],
      ['Thông báo', 'Xem các cập nhật broadcast ảnh hưởng đến section và ngày giảng dạy của bạn.'],
    ],
    metrics: {
      labels: ['Section', 'Sinh viên', 'Sẵn sàng publish', 'Thông báo mới'],
      details: [
        'Các section giảng dạy luôn hiển thị để quyết định về lịch và chấm điểm vẫn bám theo đúng học kỳ.',
        'Khối lượng enrollment luôn ở gần lecturer shell để việc theo dõi theo section không bị mất.',
        'Công việc chấm điểm sẵn sàng publish nổi lên sớm để không bị chìm giữa các việc khác.',
        'Các cập nhật broadcast ảnh hưởng đến giảng dạy vẫn hiện ra mà không kéo sự chú ý khỏi hàng chờ chấm điểm.',
      ],
    },
    queueStatusReady: 'Sẵn sàng publish',
    queueStatusProgress: 'Đang xử lý',
    studentsSuffix: 'sinh viên',
    gradedSuffix: 'đã chấm',
    errors: {
      loadFailed: 'Hiện chưa thể tải dữ liệu vận hành của dashboard giảng viên.',
      unavailableTitle: 'Dashboard giảng viên chưa sẵn sàng',
      loading: 'Đang tải dashboard giảng viên',
    },
  },
  lecturerGrades: {
    eyebrow: 'Workspace giảng viên',
    title: 'Quản lý điểm',
    description:
      'Theo dõi tiến độ chấm điểm cho {semester}, rồi đưa các section đã sẵn sàng sang bước rà soát cuối.',
    allSemesters: 'tất cả học kỳ',
    allSemestersOption: 'Tất cả học kỳ',
    selectSemester: 'Chọn học kỳ cho quản lý điểm',
    queueTitle: 'Hàng chờ quản lý điểm',
    queueDescription:
      'Lọc theo học kỳ, xem tiến độ từng section và đi tiếp vào route chi tiết để nhập điểm và publish.',
    emptyTitle: 'Chưa có section chấm điểm',
    emptyDescription:
      'Các section có trách nhiệm chấm điểm sẽ xuất hiện tại đây khi phân công giảng dạy đã sẵn sàng.',
    labels: {
      sections: 'Section',
      gradesCaptured: 'Điểm đã nhập',
      readyToPublish: 'Sẵn sàng publish',
      credits: 'tín chỉ',
      enrolled: 'đăng ký',
      graded: 'đã chấm',
      published: 'đã publish',
      sectionPrefix: 'Section',
      readyStatus: 'Sẵn sàng publish',
      manageGrades: 'Quản lý điểm',
      enterGrades: 'Nhập điểm',
    },
    details: [
      'Các trách nhiệm chấm điểm đang hoạt động được gom vào cùng một hàng chờ theo học kỳ đã chọn.',
      'Các bản ghi điểm đã nhập luôn hiện ra trước khi bạn chuyển section sang bước publish cuối.',
      'Các section có thể đi sang bước rà soát cuối được làm nổi bật mà không thay đổi grading contract.',
    ],
    errors: {
      loadFailed: 'Hiện chưa thể tải dữ liệu quản lý điểm.',
      unavailableTitle: 'Quản lý điểm chưa sẵn sàng',
      loading: 'Đang tải quản lý điểm',
    },
  },
};

export const dictionaries = {
  en,
  vi,
} as const satisfies Record<Locale, I18nMessages>;

export function getMessages(locale: Locale) {
  return dictionaries[locale];
}
