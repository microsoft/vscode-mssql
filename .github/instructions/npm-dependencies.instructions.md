---
applyTo: "**/package.json,**/package-lock.json"
---

# npm Dependencies

- For npm dependency additions and updates, including transitive lockfile changes, flag any
  selected version published less than seven full days ago. Check the actual version's publication
  timestamp in registry metadata (for example, `npm view <package> time --json`), not the package's
  creation date or last-modified date.
- Reject removed, unpublished, or otherwise unavailable releases. Verify that the exact version and
  its tarball remain available from the configured registry.
- Choose the latest compatible version that is available and at least seven days old. Keep package
  manifests, overrides, and lockfile resolutions consistent; flag mismatches or resolutions that
  bypass these restrictions.
