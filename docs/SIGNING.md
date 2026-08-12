# Release signing

QuillMesh release builds are created by `.github/workflows/release.yml`. Tagged releases intentionally fail when signing credentials are absent; this prevents an unsigned installer from being published as an official release.

## Windows

Obtain a trusted Windows code-signing certificate suitable for Authenticode. Export the certificate and private key as a password-protected `.pfx` or `.p12` file.

Add these GitHub Actions repository secrets:

| Secret | Value |
| --- | --- |
| `WIN_CSC_LINK` | Base64-encoded certificate file, or a secure certificate URL supported by electron-builder |
| `WIN_CSC_KEY_PASSWORD` | Password for the certificate file |

To generate the base64 value in PowerShell without line breaks:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('QuillMesh-signing.pfx'))
```

Never commit the certificate, password, base64 value, hardware-token PIN, or provider API credentials. Modern EV certificates may require a cloud or hardware signing service; configure that provider according to its electron-builder or `signtool` integration instead of exporting a private key when export is prohibited.

## macOS

Join the Apple Developer Program and export the `Developer ID Application` identity and private key as a password-protected `.p12` file. Create an app-specific password for notarization.

Add these GitHub Actions repository secrets:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64-encoded `.p12` signing identity |
| `MAC_CSC_KEY_PASSWORD` | Password for the `.p12` file |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password, not the normal Apple ID password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

The build enables hardened runtime, signs the `.app`, submits it to Apple notarization, and builds DMG and ZIP artifacts.

## Publishing

1. Add all required repository secrets under **Settings → Secrets and variables → Actions**.
2. Push a version tag such as `v0.2.1` only after CI and local smoke tests pass.
3. Confirm the Release workflow signs Windows and macOS artifacts and that Apple notarization succeeds.
4. Install the downloaded release artifacts on clean machines and inspect the publisher/signature before announcing the release.

Local development builds may remain unsigned, but they should not be presented as official releases. Windows SmartScreen reputation can still take time to develop even with a valid certificate; signing establishes publisher identity but does not guarantee an immediate reputation score.
