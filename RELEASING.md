# Releasing

The runbook for changing the library and getting it to users. For the *why*
behind the setup (and what it does not protect against), see
[PUBLISHING.md](PUBLISHING.md).

The next version to ship is **0.2.0**, and `0.1.0` is already on the registry —
`latest` points at it. It was published by hand, once, because a trusted
publisher lives on the package's own settings page and a package that does not
exist yet has no settings page. That bootstrap is done and is kept below as
history: every release from here on goes through CI staging plus a human
approval, and a local `npm publish` failing is then the setup working rather
than the setup broken.

## The short version

```sh
# 1. edit code under src/ (nothing generated is committed, so nothing to resync)
npm run build          # optional locally: dist/ is what you would be inspecting

# 2. prove it
npm run check

# 3. bump the version
npm version patch --no-git-tag-version   # or minor / major

# 4. land it through a PR (main is protected — direct pushes are rejected)
git checkout -b feat/whatever
git commit -am "Describe the change"
git push -u origin feat/whatever
gh pr create --fill && gh pr merge --squash --delete-branch

# 5. tag the merged commit, then stage
git checkout main && git pull --ff-only
git tag v0.2.0 && git push origin v0.2.0
gh workflow run stage.yml --ref main -f dist-tag=latest -f confirm=0.2.0

# 6. review, then approve (this is the only step that publishes)
npm run release -- list                  # find the stage-id
npm run release -- view <stage-id>
npm run release -- approve <stage-id>

# 7. confirm users can get it
npm view @citisen/litearea dist-tags
```

The version in this loop is the one you just bumped to — here, `0.2.0`. The one
release CI could not make is the first one, `0.1.0`, which was published by hand
under [Bootstrapping the first release](#bootstrapping-the-first-release); that
section is now history rather than a to-do.

## Bootstrapping the first release

**Done** — kept because it is the one release the CI path cannot make, and the
one place a local credential was ever needed. `0.1.0` is on the registry. It had
to be published by hand, because trusted publishing is configured on a package's
**own settings page**, and a package that does not exist yet has no settings
page. The sequence was:

1. `npm login`, then `npm run check`, then `npm publish` — that put `0.1.0` on
   the registry with 2FA.

   `publishConfig.access` in `package.json` is already `public`, so there was no
   `--access` flag to remember. The `prepublishOnly` hook ran `npm run check`
   again on the way out, which is deliberate: a hand publish is the one path
   with no CI gate in front of it, so the gate is attached to the command
   instead.

2. Configure the trusted publisher for it: see
   [PUBLISHING.md](PUBLISHING.md#one-time-setup). From then on, CI can stage and
   nothing local needs publish rights at all.

3. Verify the OIDC path actually works by cutting the next release through CI
   — a staged tarball that a human approves, with no token involved. **This is
   the step that is not yet proven**: a *configured* trusted publisher says
   nothing about whether the exchange works, so the first staging run is the
   proof, not the settings page.

4. Revoke the local token, once step 3 has succeeded. Until it does, `0.1.0`
   remains both the only version this package has ever published and the only
   one that bypassed CI.

## Step detail

### 1. Edit and build

Everything under `src/` is hand-written and everything under `dist/` is
generated, and the build is **not committed** — `dist/` is in `.gitignore`, and
the tarball npm assembles from the staged commit is the only built copy that
exists. That removes a whole class of
"the generated file is stale" failure, and it means the version you ship is
always built from the commit you tagged.

```sh
npm run build     # tsup (ESM + CJS + types), then scripts/build-css.mjs
npm run watch     # rebuild the JS on save, while the demo runs elsewhere
npm run demo      # a Vite playground for typing into the real component
```

You only need `npm run build` locally to look at output or to run the demo
against a fresh bundle. CI rebuilds from source before doing anything else, so a
missing `dist/` is never a reason a release fails.

### 2. Prove it

```sh
npm run check
```

That is `typecheck && build && test && verify && browser`, and it is the same
command the workflow runs, so there is no "works locally" gap to reason about:

| Step | What it covers |
| --- | --- |
| `npm run typecheck` | the public types, including the `.d.ts` tsup emits |
| `npm run build` | tsup, then `scripts/build-css.mjs` — the artifact must exist at all |
| `npm run test` | the pure engine under vitest: scanning, grammar resolution, completion ranges, ranking, formatting |
| `npm run verify` | `scripts/verify-package.mjs`, a Node verifier that reads the package the way an installer would |
| `npm run browser` | the headless-Chromium harness against a real textarea |

The last one is the only part of the gate that cannot be replaced by a stub, and
it is worth being precise about why. A completion is an edit to the document
performed from outside the textarea, and the property that makes it feel native
is that the edit lands on the textarea's **own undo stack** — so one Ctrl+Z
takes back the completed text, and the caret ends up where the user expects
rather than at the end of a rewrite. That stack is the browser's, not ours: no
DOM stub implements one. A happy-dom test can only assert that the stub did what
we told it to, which is exactly the assertion that stays green while the real
behaviour breaks. `npm run browser` is where that claim is actually checkable.

A passing harness is still not the same as a pleasant editor. Type into it once
per release against the demo, because feel is not assertable:

```sh
npm run demo
```

Open the completion list mid-word, accept a row with Enter and with Tab, press
Ctrl+Z and watch what comes back, hover an identifier, and introduce a syntax
error to see the squiggle and the tooltip.

### 3. Bump the version

```sh
npm version patch --no-git-tag-version   # or minor / major
```

`--no-git-tag-version` matters: it stops npm from creating the tag on the
pre-merge commit. The tag has to point at the commit on `main`, and the workflow
checks that with `git tag --points-at HEAD`.

### 4. Land it through a PR

Landing through a PR is the intended path, and the reason is not tidiness: the
publishing grant trusts the repository, so push access effectively *is* publish
access, and a required PR is what stops a direct push from being a silent
release.

> **Not enforced yet.** `main` is currently unprotected — a direct push
> succeeds. Apply branch protection (required PR, linear history, no force
> pushes, no deletions, `enforce_admins: true`) before relying on this step; see
> [PUBLISHING.md](PUBLISHING.md#one-time-setup).

Once it is on, required approvals is 0, because GitHub will not let you approve
your own PR, so you can `gh pr merge --squash` your own work. Linear history is
required, so squash or rebase rather than merge-commit.

### 5. Tag, then stage

```sh
git tag v0.2.0 && git push origin v0.2.0
gh workflow run stage.yml --ref main -f dist-tag=latest -f confirm=0.2.0
```

The `confirm` input must equal `package.json`'s version exactly — it exists to
catch a wrong-version release.

The workflow refuses to stage when:

| Refusal | Meaning |
| --- | --- |
| confirmation ≠ `package.json` version | wrong version typed |
| `npm run check` fails | it does not typecheck, the build is broken, a unit test fails, the verifier rejects the package, or the browser harness fails |
| version already published **or staged** | bump it; approve or reject the old stage first |
| `latest` without a `v<version>` tag on that exact commit | tag the merged commit first |

It also deletes any `.npmrc` and unsets `NODE_AUTH_TOKEN`/`NPM_TOKEN` before
staging, so a stray credential fails closed rather than quietly overriding the
OIDC exchange.

### 6. Review, then approve

**Staging is not publishing.** After a successful run nothing is installable:
`npm view @citisen/litearea version` still reports `0.1.0`, the current release.
A human must approve, and npm gates that on 2FA.

```sh
npm run release -- list                  # find the stage-id
npm run release -- view <stage-id>       # metadata, and who staged it
npm run release -- download <stage-id>   # the tarball itself
npm run release -- approve <stage-id>    # publishes — requires 2FA
npm run release -- reject <stage-id>     # discard it
```

`npm run release` exists because `npm stage` needs npm ≥ 12 while this machine's
npm may be older; the helper runs `npx npm@12` so you never have to upgrade
globally. The bare `npm stage ...` commands npm's website shows **will not work
here** — `Unknown command: "stage"`. Keep the `run release --` prefix and the
`--`: the `--` is what stops npm from swallowing the subcommand and its
arguments, and without it the helper is invoked with nothing to do.

Reviewing properly means checking `staged by:` reads
`GitHub Actions (trusted automation)`, and — if you did not build it yourself —
actually opening the downloaded tarball. Approving on autopilot turns the gate
into a click.

### 7. Confirm

```sh
npm view @citisen/litearea dist-tags        # latest should now be the new version
```

Then verify the *published* artifact, not just the working tree. There is no
committed build to compare against, so the only way to know the `files` array,
the `exports` map, and the emitted types agree with each other is to install what
npm actually served:

```sh
mkdir -p /tmp/litearea-scratch && cd /tmp/litearea-scratch
npm init -y >/dev/null
npm install @citisen/litearea
ls node_modules/@citisen/litearea/dist   # index.js, index.cjs, react.*, styles.*, styles.css, types/
node -e "import('@citisen/litearea').then(m => console.log(Object.keys(m).length, 'exports'))"
```

## Things that will bite you

**A published version cannot be reused, and may not be deletable.** npm allows
unpublishing only within 72 hours and discourages it; beyond that the version
number is burned. If you ship something broken, publish a patch.

**A pushed tag should not be moved.** Force pushes are off by default, and moving
a tag would defeat the ancestry check anyway: the workflow matches a tag on the
exact commit with `git tag --points-at HEAD`, so a moved tag describes a release
of a commit no tag ever pointed at. Tagged a commit and then found a problem?
Bump the version and tag again. (Until branch protection is applied, nothing
technically refuses the move — this is a rule, not a lock.)

**`dist/` is not committed, and nothing builds it on install.** There is no
`prepare` script — the gate builds the library and the tarball carries the
result, which is correct for the registry and a trap for a git-URL install:
`npm install citisen/litearea` resolves `main` to a file that was never built.
Ship users the published package, not the repository.

**npm silently skips a `files` entry that does not exist.** No warning, no
failure, no sign locally that anything is missing — the tarball just lacks it,
and the first person to notice is a user. That is the failure `npm run verify`
exists to catch before staging, which is why it runs against the built package
rather than against `src/`.

**React is an optional peer, and the core entry must stay React-free.** `react`
and `react-dom` are devDependencies so the demo and the harness can run; a
consumer who only imports `@citisen/litearea` should never need them. An import
of React anywhere the core entry reaches turns that into a runtime crash for
exactly those users, and the tarball gives no hint that it happened.

**A completion that bypasses the textarea's insert path looks right and cannot
be undone.** `document.execCommand('insertText')` and a direct `textarea.value`
write both produce identical pixels and completely different undo behaviour. No
Node-level test can tell them apart, which is why the browser harness is in the
gate rather than in a "run it if you have time" list.

**happy-dom is not a browser.** Unit tests are the right place for the pure
engine and the wrong place to conclude anything about caret geometry, selection,
scroll, or compositing. A green suite with a broken editor in it is a normal
outcome if the browser step is skipped.

## Quick reference

| Task | Command |
| --- | --- |
| Rebuild the library | `npm run build` |
| Rebuild the JS on save | `npm run watch` |
| Full local gate | `npm run check` |
| Browser harness alone | `npm run browser` |
| Try it by hand | `npm run demo` |
| Bump version | `npm version patch --no-git-tag-version` |
| Open + merge a PR | `gh pr create --fill && gh pr merge --squash --delete-branch` |
| Tag and stage | `gh workflow run stage.yml --ref main -f dist-tag=latest -f confirm=<version>` |
| List stages | `npm run release -- list` |
| Review a stage | `npm run release -- view <stage-id>` |
| Fetch a staged tarball | `npm run release -- download <stage-id>` |
| Publish (2FA) | `npm run release -- approve <stage-id>` |
| Discard a stage | `npm run release -- reject <stage-id>` |
| Check what users get | `npm view @citisen/litearea dist-tags` |
