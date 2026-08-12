# Open-source release checklist

## Repository

- [x] Keep the original ColaMD MIT copyright notice and source attribution.
- [x] Rename the original Git remote to `upstream` to prevent accidental pushes.
- [x] Ignore local installers, scratch files, exports, logs, and secrets.
- [x] Add contribution, conduct, security, changelog, issue, and pull-request guidance.
- [x] Add CI for type checks, deterministic regression coverage, builds, and Companion smoke tests.
- [x] Create the public QuillMesh repository.
- [x] Add the public repository as `origin`.
- [x] Review the staged file list and prepare the first QuillMesh commit intentionally.

## GitHub settings

- [ ] Add the repository description, topics, social preview, and website if one exists.
- [ ] Enable Issues, Discussions if desired, branch protection for `main`, and private vulnerability reporting.
- [ ] Require the CI check before merging.
- [ ] Create `bug` and `enhancement` labels used by the issue forms.

## First release

- [ ] Confirm the version in `package.json`, Companion metadata, README files, and changelog.
- [ ] Test a clean checkout with Node.js 22.12 using `npm ci` and `npm run verify`.
- [ ] Build and manually smoke-test each published operating-system artifact.
- [x] Configure the release workflow to require Windows signing and macOS signing/notarization secrets.
- [ ] Upload the real certificate and Apple credentials as repository Actions secrets.
- [ ] Publish installers through GitHub Releases rather than committing them to Git.
- [ ] Verify packaged licenses, application icons, file associations, welcome screen, save/conflict flow, and uninstall behavior.
