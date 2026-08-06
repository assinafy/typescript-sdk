# Releasing

GitLab is the canonical repository and push-mirrors branches and tags to
GitHub. Publishing is performed by `.github/workflows/release.yml` when GitHub
receives a tag matching `v*`; a mirrored tag does not create a GitHub `release`
event, and the workflow intentionally does not depend on one.

## Release support matrix

| Runtime | Release responsibility |
| --- | --- |
| Bun 1.3.14 | Locked install, tests, build, audit, and packaging |
| Node.js 22 | Minimum supported consumer runtime |
| Node.js 24 LTS | Packaging and registry publishing runtime |
| Node.js 26 Current | Forward-compatibility consumer test |

Keep this table, `package.json`, GitLab CI, and the GitHub workflows synchronized
when changing runtime support.

## One-time registry setup

### npm trusted publishing

Configure the npm package `@assinafy/sdk` with a GitHub Actions trusted
publisher using these repository coordinates:

| npm setting | Value |
| --- | --- |
| Organization or user | `assinafy` |
| Repository | `typescript-sdk` |
| Workflow filename | `release.yml` |
| Environment | Leave unset unless the workflow is updated to use one |

The `publish-npm` job grants only `contents: read` and `id-token: write`.
Modern npm exchanges GitHub's short-lived OIDC identity for publish credentials;
no long-lived `NPM_TOKEN` is required. Test trusted publishing before deleting a
legacy token, then remove that token from repository and organization secrets.

### GitHub Packages

The `publish-gh` job uses the workflow-scoped `GITHUB_TOKEN` with
`packages: write`. Confirm that organization policy permits Actions to publish
the `@assinafy` scope and that the package remains linked to this repository.
No separate personal access token should be stored.

### Mirror and tag protection

The GitLab push mirror must include tags and be able to update the GitHub
repository. Protect release tags in GitLab so only release maintainers can
create patterns matching `v*`. GitHub Actions must be enabled on the mirror.

## Preparing a release

1. Merge the complete change through GitLab and confirm both GitLab and mirrored
   GitHub CI are green.
2. Choose the semantic version and update `package.json`. Keep the tag exactly
   `v<package-version>`; the workflow rejects a mismatch.
3. Update `CHANGELOG.md`, API coverage, compatibility notes, and public examples
   for all user-visible changes.
4. Install and run the complete local release gate from a clean checkout:

   ```sh
   bun install --frozen-lockfile
   bun run verify
   bun run audit
   bun run audit:api
   ```

5. For API changes, run the live audit against a dedicated sandbox. Start
   read-only:

   ```sh
   ASSINAFY_API_KEY='...' \
   ASSINAFY_ACCOUNT_ID='...' \
   ASSINAFY_BASE_URL='https://sandbox.assinafy.com.br/v1' \
   bun scripts/live-smoke.ts
   ```

   Then run the reversible suite with two controlled recipients:

   ```sh
   ASSINAFY_API_KEY='...' \
   ASSINAFY_ACCOUNT_ID='...' \
   ASSINAFY_BASE_URL='https://sandbox.assinafy.com.br/v1' \
   ASSINAFY_TEST_EMAIL_PRIMARY='first@example.com' \
   ASSINAFY_TEST_EMAIL_SECONDARY='second@example.com' \
   bun scripts/live-smoke.ts --all
   ```

   The suite creates and force-deletes a disposable workspace, but an
   interrupted process can still leave fixtures behind; inspect the sandbox
   before releasing. Treat every `FAIL` as a release blocker and review each
   `SKIP` to confirm its password, provider-token, signer-code/OTP, legal-action,
   final-artifact, or webhook-receiver prerequisite was intentionally absent.
   Never use production credentials or uncontrolled recipients.

6. Commit the version and release notes, merge them to the canonical default
   branch, then create a signed or annotated `v<version>` tag on that exact
   commit and push the tag to GitLab.
7. Confirm that the tag reaches GitHub and starts the **Release** workflow. Do
   not create or move a second tag to work around mirror delay.

## What the workflow publishes

The workflow serializes releases repository-wide and performs these steps:

1. verify that the tag and `package.json` versions match;
2. install from `bun.lock`, run `verify` and `audit`, and build once;
3. create one `.tgz` with lifecycle scripts disabled and record its SHA-256;
4. upload that archive and checksum as a one-day workflow artifact;
5. verify and publish the archive to npm through trusted-publisher OIDC; and
6. verify and publish the **same bytes** to GitHub Packages using
   `GITHUB_TOKEN`.

The GitHub Packages job depends on npm publishing, preventing a GitHub-only
release when npm fails. Both registry jobs validate `SHA256SUMS`; neither
rebuilds or repacks the SDK. This immutable-artifact flow is part of the release
contract and must be preserved when editing the workflow.

## Verification and recovery

After publishing, confirm that the expected version appears on npm and GitHub
Packages and that a clean Node.js consumer can import both the ESM and CommonJS
entrypoints. Compare the downloaded artifacts when registry tooling permits.

If packaging or npm publishing fails, fix the source, increment or retain the
version as registry state allows, and create a new tag only after review. Never
move a tag that has published a package.

If npm succeeds and GitHub Packages fails, rerun only the failed job while the
original one-day workflow artifact is retained. This preserves the exact
archive already published to npm. Do not repack an approximation or unpublish a
released npm version. If the artifact has expired, stop and review recovery with
the maintainers before changing workflow dependencies or registry state.

For a defective published release, prefer deprecating the affected version and
shipping a reviewed patch. Record the incident and remediation in the
changelog and any applicable security advisory.
