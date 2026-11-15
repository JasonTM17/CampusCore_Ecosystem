# Accessibility across workflow states

For multi-role workflows, test the visible and keyboard path for success,
permission denial, validation failure, loading, timeout, retry and recovery.
Check focus order/restoration, semantic names, status announcement, error text,
contrast, zoom/reflow and motion preference where relevant. Verify inaccessible
controls are not the sole guard; server authorization remains authoritative.

Record viewport, assistive technology/browser when actually used, actor, state,
expected outcome and observed result. Automated scans are useful static
evidence; they do not prove a complete assistive-technology experience. Report
unavailable browser/AT capability as NOT_RUN.
