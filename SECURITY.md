# Security policy

## Supported versions

QuillMesh is currently pre-1.0. Security fixes are provided for the latest released version only.

## Reporting a vulnerability

Do not publish exploitable details, tokens, private documents, or proof-of-concept payloads in a public issue.

Use GitHub's **Report a vulnerability** action on the repository Security page when private vulnerability reporting is enabled. If it is not yet enabled, open a minimal issue asking the maintainers for a private contact channel, without including sensitive technical details.

Please include the affected version and operating system, impact, reproduction conditions, and any suggested mitigation. Maintainers will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

## Local data model

QuillMesh reads and writes local Markdown and assets. The Companion bridge binds to `127.0.0.1` and requires a random bearer token. Reports involving path containment, revision bypass, bridge authentication, unsafe exported HTML, or unintended external network access are especially useful.
