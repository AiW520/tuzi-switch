# Download page source and attribution

This standalone test download page adapts the Tuzi Assistant download HTML from
`tuziapi/tuzi-api` (new-api by QuantumNous), based on
`5599625542131f42177596d1a74903f59f581710` plus the locally approved download-page
changes of November 1, 2026. The page's inherited AGPL-3.0 licensing is retained
in `LICENSE`. This directory is distributed separately from the desktop app;
the desktop app's existing attribution and root license remain intact.

Modifications: retain the approved visual design, replace account/API-dependent
release loading with build-time metadata for GitHub Actions test artifacts,
include Intel macOS, and preserve optional Umami download-click reporting.

The GitHub source link in the built page points to the exact public commit,
including this directory and `scripts/build-download-site.cjs`.
