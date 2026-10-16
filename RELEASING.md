# Releasing Desk Audio Bridge

## Distribution preparation

`corepack yarn desktop prepare:release` generates the original icon and full dependency notices. The inventory covers production dependencies and JavaScript bundled into the renderer, including vendored notices. It excludes build-only Next.js native image/compiler tooling, which is not shipped. Eight supplements document MIT/ISC declarations where published archives omit standalone license files; provenance is included and no copyright dates are fabricated.

Electron Builder's `afterPack` gate compares every shipped Node package against that inventory, requires the Greenlight and runtime notices, and rejects the unused npm CLI, old artwork, fonts, and common private credential-file formats. A new dependency, unreviewed license expression, or missing notice stops distribution packaging.

The internal app ID and package/profile name are intentionally retained for upgrades. The installer, application window, tray, and original icon use Desk Audio Bridge. On upgrade the app preserves its user-data path and refreshes the login-at-startup entry for the new executable name.

For the unsigned Windows build, the `afterPack` hook applies the icon and executable version information using the build-only Electron rcedit wrapper. This avoids extracting the legacy cross-platform signing-tools archive, which requires symlink privileges on some Windows systems. The tool is not shipped in the application.

Distribution artifacts should contain only the installer, SHA-256 checksum, and release notes. Never zip the installed user profile, logs, caches, or credential store. Each recipient signs in independently.

Publish source and release assets to the public repository https://github.com/KieranStokes/desk-audio-bridge. Releases are uploaded manually after verification; upstream multi-platform build, publishing, and auto-merge workflows are not enabled in this fork. Trusted signing requires the owner's signing identity or certificate; unsigned beta releases are clearly labeled.

## Controller compatibility: 0.1.12 candidate

Audio mode briefly attaches and immediately detaches remote controller index 3 (the fourth remote slot) during authorization. It never starts input drivers or sends controller input frames. The fourth remote slot does not guarantee a particular physical controller/player assignment inside a game; verify both bridge-first startup and reconnecting during NBA 2K before treating this as resolved.

Do not restore the 0.1.11 approach of omitting all controller announcements: a live Xbox test reproduced the roughly 60-second startup cutoff despite successful HTTP keepalives and real frame metadata. A removal-only announcement and zero-controller-frame reports also failed. Simulated metadata tests cannot verify the Xbox host's initialization requirements.

## Local beta build

Run `corepack yarn desktop build`, then verify the newest installer:

```powershell
corepack yarn workspace xbox-audio-bridge verify:release
```

The verifier prints the installer path, size, SHA-256 hash, and Authenticode publisher. An unsigned local beta is allowed, but Windows may show an Unknown Publisher warning.

## Trusted signed build

Obtain a Windows code-signing certificate from a trusted provider, export it as a password-protected PFX, and provide it outside the repository:

```powershell
$env:WIN_CSC_LINK = 'C:\secure\XboxAudioBridge.pfx'
$env:WIN_CSC_KEY_PASSWORD = '<certificate password>'
corepack yarn workspace xbox-audio-bridge build:signed
```

`build:signed` enables electron-builder's `forceCodeSigning` option and fails unless the resulting installer has a valid Authenticode signature. Never commit the certificate or password.

Before distributing a build, run the lint, TypeScript, protocol, and clean-profile smoke tests; install it on a separate Windows user or VM when one is available; and keep the SHA-256 hash with the release notes.
