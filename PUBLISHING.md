# Publishing

`@citisen/litearea` is published in two halves:

1. **CI stages** a tarball — `.github/workflows/stage.yml`, over npm
   [trusted publishing](https://docs.npmjs.com/trusted-publishers). No secret is
   involved.
2. **A human approves** it, via [staged publishing](https://docs.npmjs.com/staged-publishing),
   which requires that human's 2FA.

There is no `NPM_TOKEN` in this repository and there must never be one.

## Why this is safer than a token

A publish token is a bearer secret: anything that can read it can publish to the
package from anywhere, forever, until someone notices and rotates it. It usually
has to bypass 2FA to be usable by a machine, which removes the one control that
would otherwise stop an attacker.

Trusted publishing replaces the secret with a **short-lived OIDC identity** that
GitHub mints per run and npm exchanges for a staging grant. Nothing to steal,
nothing to leak into a log, nothing to rotate. The grant is scoped to this
repository, this workflow file, and the `npm-publish` environment, so it cannot
be replayed from another repo or a laptop. npm attaches a signed provenance
attestation automatically.

## Why staged rather than direct

npm's trusted-publisher form offers an **Allowed actions** checkbox for
`npm publish`, and warns that leaving it unchecked is stronger. That warning is
correct, and this repository leaves it **unchecked**.

Checked, the workflow's OIDC grant can publish unattended — so anything that can
run the workflow puts a version on the registry and makes it installable,
immediately, with no further check.

Unchecked, the same grant can only *stage*. `npm stage publish` uploads the
tarball and stops; nothing is installable, and `npm view` still reports the
previous version. Publishing then needs `npm stage approve`, which npm gates on
the maintainer's 2FA. A compromised runner, a malicious commit, or a bad
dependency in CI gets as far as a staged tarball that a human still has to look
at and approve.

That human step is what holds the security boundary in practice, because trusted
publishing moves the trust boundary from *whoever holds the token* to *whoever
can push*. `main` is therefore meant to be protected like the sibling packages:
required PR, linear history, no force pushes, no deletions, and
`enforce_admins: true` — so a mistaken direct push is refused for the maintainer
too.

> **Status: not applied yet.** As of `0.2.0` the branch is unprotected.
> `gh api repos/citisen/litearea/branches/main/protection` answers
> `Branch not protected` (404), and a direct push to `main` succeeds. Everything
> below describes the intended design; until the rule is created in
> *Settings → Branches*, the only thing standing between a push and a release is
> the human approval of the stage.

**The strongest configuration is all three: staging, a protected `main`, and a
protected `npm-publish` environment.** The third one is opt-in (see below).

## Bootstrapping: the first release was by hand

A trusted publisher is configured on the package's own settings page, so a
package that does not exist yet cannot have one. That is why `0.1.0` was
published by hand, once, before any of the rest of this document could apply:

1. `npm login`, then `npm run check`, then `npm publish`
   — **done**: `0.1.0` is on the registry, with 2FA. `publishConfig.access` is
   already `public`, and the `prepublishOnly` hook ran the gate on the way out.
2. Configure the trusted publisher as below.
3. Cut the next release through CI staging and approve it — that proves the OIDC
   path works end to end.
4. Revoke the local token and remove the `_authToken` line from `~/.npmrc`.

Steps 3 and 4 are not self-certifying. Whether the trusted publisher is
*configured* is a setting you can read; whether the OIDC exchange *works* is only
demonstrated by a staging run that reaches `npm stage publish`, and whether the
approval gate works is only demonstrated by an approval. **Step 3 is done, all
the way through**: the `0.2.0` stage was created by `GitHub Actions (trusted
automation)` with no token on the runner, and approving it published the version —
`npm view @citisen/litearea dist-tags` reads `latest: 0.2.0`. Step 4 is the one
still outstanding: until the local credential is revoked, `0.1.0` remains the only
version this package published by hand, and the hand publish the only one nothing
in this document had to protect.

## One-time setup

### 1. Configure the trusted publisher on npm

<https://www.npmjs.com/package/@citisen/litearea/access> → **Trusted
Publishers** → *Add a trusted publisher* → **GitHub Actions**, and enter exactly:

| Field | Value |
| --- | --- |
| Organization or user | `citisen` |
| Repository | `litearea` |
| Workflow filename | `stage.yml` |
| Environment | `npm-publish` |
| Allowed actions | leave **`npm publish` UNCHECKED** (staged publishing only) |

The filename is matched literally and must live at
`.github/workflows/stage.yml`. **Renaming or moving that file stops CI staging**
until you update this setting. The environment must match the `environment:` key
in the workflow; to skip the reviewer gate, remove that key from both.

### 2. Set publishing access, then revoke every token

On the same page set **Publishing access** to *Require two-factor authentication
and disallow tokens*.

Then delete every credential that could still publish:
<https://www.npmjs.com/settings/~/tokens> → revoke any **Automation** or
**Granular** token with publish rights, especially any with *bypass 2FA*
enabled. Remove the `//registry.npmjs.org/:_authToken=...` line from `~/.npmrc`
on every machine once you stop releasing by hand.

Skipping this leaves the old door open — the OIDC path being locked down says
nothing about a token that is still live.

**`npm publish --dry-run` cannot verify this.** Trusting it is the trap this
paragraph used to set: a dry run packs the tarball locally and reports, and npm
deliberately downgrades even a *missing credential* to a warning in that mode —
from its own `lib/commands/publish.js`:

```js
if (noCreds) {
  const msg = `This command requires you to be logged in to ${outputRegistry}`
  if (dryRun) {
    log.warn(this.#command, `${msg} (dry-run)`)
  } else {
    throw Object.assign(new Error(msg), { code: 'ENEEDAUTH' })
  }
}
```

A dry run does catch a version that is already published (it reads the packument
first), which is worth knowing — but it says nothing about who may write.

Verify the reduction where the setting actually lives:

- The package page's **Settings → Publishing access** reads *Require two-factor
  authentication and disallow tokens*.
- The token page lists no **Automation** or **Granular** token with publish
  rights for this scope, and `~/.npmrc` has no `registry.npmjs.org` auth token
  left on a machine you release from.

The only *dynamic* proof is a real publish that fails, and that is not worth
running against a live package. It is also unnecessary: with tokens disallowed,
the OIDC grant plus a human approval is the only path that can put a version on
the registry — which is exactly what the staging workflow exercises on every
release. `0.1.0` predates it; the `0.2.0` stage is the run that proved it for
this package.

### 3. Optionally gate staging on a reviewer

Create an environment named `npm-publish` in *Settings → Environments* and add
required reviewers. The workflow already references it; no edit is needed. GitHub
also creates the environment on the first run, with no protection rules — which
is why this step is worth doing deliberately. If the environment requires a
reviewer, the staging run pauses there until someone approves it, and that
approval is a second, separate gate from the stage approval.

> Prefer this one over step 4 if you only want one gate: reviewers on the
> environment are checked *before* the runner stages anything, whereas branch
> protection only constrains who can write the commit.

### 4. Protect `main`

*Settings → Branches → Add branch protection rule* (or a repository ruleset) for
`main`, with: require a pull request before merging, require linear history,
block force pushes, block deletions, and — the one that matters — *Do not allow
bypassing the above settings*, which is `enforce_admins: true`.

**This is not applied on `@citisen/litearea` yet** (see the status note above).
It is the step that makes the rest of this document structural rather than
advisory: without it, anyone who can push to `main` can run the staging workflow
on a commit they wrote, and the only remaining check is a human reading the
stage. Worth checking from a terminal rather than by memory:

```sh
gh api repos/citisen/litearea/branches/main/protection
```

A 404 (`Branch not protected`) means it is still not on.

## Cutting a release

```sh
# on main, through a PR
npm version patch --no-git-tag-version   # or minor / major
git commit -am "Release v0.2.0"
git tag v0.2.0
git push --follow-tags
```

Then **Actions → Stage release → Run workflow**, pick the dist-tag, and type the
version to confirm. The full runbook, including the PR step, is in
[RELEASING.md](RELEASING.md).

The workflow refuses to run when:

- the typed confirmation does not match `package.json`
- `npm run check` fails — the library does not typecheck, the build (tsup plus
  `scripts/build-css.mjs`) does not produce the artifact, a unit test fails, the
  package verifier rejects what would be shipped, or the real-browser harness
  fails
- the version is already published **or already staged**
- you asked for `latest` without a `v<version>` tag pointing at exactly the
  commit being released

It also deletes any `.npmrc` and unsets `NODE_AUTH_TOKEN`/`NPM_TOKEN` first, so a
stray credential fails closed instead of quietly overriding the OIDC exchange.

### Approving

```sh
npm run release -- list                  # find the stage-id
npm run release -- view <stage-id>       # inspect before trusting it
npm run release -- approve <stage-id>    # publishes; requires your 2FA
npm run release -- reject <stage-id>     # discard
```

The helper delegates to `npx npm@12` because `npm stage` needs npm ≥ 11.6 (12 for
the current subcommands) and Node 22.22 / 24.15 / 26+, which the local Node may
not satisfy. `approve` is the only step that publishes, and npm demands your 2FA
there.

Inspect the staged tarball before approving a release you did not build yourself
— `npm run release -- download <stage-id>` fetches it. That is the whole value of
the gate: the approval is only meaningful if the artifact is actually looked at.

## Verifying a published release

```sh
npm view @citisen/litearea --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const v=j['dist-tags'].latest;console.log(v, j.versions[v].dist.integrity);console.log(j.versions[v].dist.attestations)})"
```

For an end-to-end check, install the published tarball into a scratch directory
and exercise it from where it landed:

```sh
mkdir -p /tmp/litearea-scratch && cd /tmp/litearea-scratch
npm init -y >/dev/null
npm install @citisen/litearea
ls node_modules/@citisen/litearea/dist   # index.js, index.cjs, react.*, styles.*, styles.css, types/
node -e "import('@citisen/litearea').then(m => console.log(Object.keys(m).length, 'exports'))"
```

This matters more here than for a package that commits its build. `dist/` is
**gitignored** — it does not exist in a checkout at all, and nothing in the
repository can be compared against it. The tarball npm assembles from the staged
commit is the only copy of the built library that will ever exist, so the
`files` array, the `exports` map, and the type declarations can only be shown to
be right by installing what was actually published. A path promised in
`package.json` but never written by the build is invisible locally and fatal
remotely.

## Where the signing key lives

The workflow is deliberately two jobs:

- **`build`** holds `contents: read` and nothing else. It runs `npm ci
  --ignore-scripts`, this repository's own checks, and `verify-release.mjs`,
  which packs the tarball once and prints its sha512 into the run summary. It
  has no `id-token`, and the gate fails outright if OIDC ever shows up there.
- **`stage`** is the only job with `id-token: write`, and it runs no repository
  code at all: no checkout, no `npm ci`, no cache, no build step. It re-hashes
  the tarball the build job produced, refuses anything that does not match, and
  uploads exactly those bytes.

That split is the point of the May 2026 TanStack / "Mini Shai-Hulud"
compromise: the attacker never stole an npm token. They got code to execute
inside the job that could mint one, and published under the project's own
trusted-publisher identity, attestations and all. Keeping the signing capability
in a job that executes no third-party code removes that path, and `npm-publish`
requires a human approval before the staging job starts — so no OIDC token
exists until a person clicks.

Approving is the last mile, and a stage-id alone does not say *what* is in the
queue. Copy the integrity out of the run summary and pass it, so that the
approval is checked rather than assumed:

```sh
npm run release -- approve <stage-id> --expect sha512-…
```

Without `--expect` the command still works, but it warns that it could not
compare the staged bytes against the ones CI built.
