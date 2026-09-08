# FORK.md — rules for this personal fork

This is a personal fork of Actual Budget (`upstream` = `actualbudget/actual`) that syncs
against a **vanilla sync server on PikaPods**. Everything below exists to keep the budget
file readable by vanilla clients and to keep monthly upstream merges cheap.

## Branches

- **`master`** — pristine mirror of `upstream/master`. Never commit here.
  Advance with `git merge --ff-only upstream/master`.
- **`fork/main`** — long-lived integration branch. Build and install from this.
- Feature work on short topic branches off `fork/main`, squash-merged in.

Merge `master` into `fork/main`. **Do not rebase `fork/main`** — rebasing a long-lived
feature re-resolves the same conflicts every month, whereas a merge records each
resolution once and marks which upstream base a build came from.

## Staying in sync with upstream

Falling behind is not merely stale — see _Migration direction is the real trap_ below.
`.github/workflows/fork-sync.yml` polls nightly and opens a PR when vanilla ships a release;
`bin/fork-sync` does the local half.

### What counts as "a new release"

The trigger rule, stated once so it doesn't become folklore:

```
version in packages/desktop-client/package.json on upstream/master
  != the same field on fork/main
```

Upstream bumps `version` across 7 `package.json` files **on master** (via its
`🔖 (X.Y.Z)` PR), and this fork touches no `version` field — so a difference means a
release landed and equality means we already carry it. That is stateless: no marker
tag, no state file, self-healing across missed runs, and it catches hotfixes (26.9.1)
for free.

### Why the merge takes `upstream/master`, never the release tag

Upstream keeps **one long-lived `release` branch** and tags it. Those tags are _not_
ancestors of `master` — release cuts are squash-merged onto `release`, so its merge-base
with master runs months stale (3.5 months / 394 commits as of 26.9.0). But every
functional release commit **is** already on master: fixes land on master first and are
cherry-picked forward. So merging `upstream/master` is content-equivalent-or-newer than
the tag, keeps the ff-only mirror intact, and satisfies the never-be-behind rule.
Merging the tag itself would replay months of cherry-pick duplicates as conflicts.

### The local half

```bash
bin/fork-sync              # fetch, ff master, merge into fork/main, then check
bin/fork-compat-check      # just the hard-rule gate, on demand
```

`bin/fork-sync` refuses to run on a dirty tree or off `fork/main`, and never pushes or
tags. On conflict it prints the conflicted paths with the guidance from _Keeping merges
cheap_ and stops — resolve, then re-run. Conflict resolution deliberately happens here
rather than in CI, because knowing a resolution in `loot-core` is right means building
and running the app.

`bin/fork-compat-check` turns the hard rules above into a gate: it diffs
`origin/master...HEAD` (three-dot, so **only the fork's own changes** are judged — an
upstream migration is never counted against you) and fails on a fork-added or
fork-modified migration, a fork-added `.sql`, a changed `X-ACTUAL-FORMAT` or
`SYNC_FORMAT_VERSION`, or any fork change under `packages/sync-server/`. CI runs it on
the merge result; run it yourself before pushing a merge.

### The CI half

`Fork Upstream Sync` fast-forwards `origin/master`, force-updates one stable branch
`fork/sync-upstream` to the upstream commit, and opens/updates a single PR into
`fork/main`. One branch and one PR ever, so a second release landing before the first
merges just updates it rather than leaving a stale PR behind. Nothing with conflict
markers is ever pushed: the branch is a plain pointer at upstream, so the PR reads
correctly whether the merge is clean or conflicted, and merging it produces exactly the
`master` → `fork/main` merge commit this file mandates.

CI validates the merge **ephemerally** — it merges in the runner, runs the compat gate,
`check-migrations`, `typecheck`, `lint` and `test`, and never pushes that merge. A
conflicted sync is reported, not failed; it is an expected outcome. The PR body carries a
risk report: which sync-critical paths upstream touched, and which files changed on both
sides (the conflict predictor).

It also re-disables upstream workflows on every run, because a merge introduces new
workflow files and they arrive enabled (see _CI_ below). The allowlist is by **file
name** — `fork-desktop.yml` and `fork-sync.yml` — and must not be a `fork-*` glob:
`fork-pr-welcome.yml` is upstream's file despite its name.

### Two one-time GitHub settings

Neither is code, and the workflow cannot do either for itself:

1. **The default branch must be `fork/main`.** GitHub runs `schedule` and
   `workflow_dispatch` only from the default branch, and `master` here is a pristine
   mirror that must never be committed to — so the workflow can only live on `fork/main`.
   Settings → General → Default branch.
2. **Enable the workflow.** Scheduled workflows are disabled by default in a fork:
   `gh workflow enable "Fork Upstream Sync"`, or the Actions tab. A private repo is exempt
   from the 60-day inactivity auto-disable, so no keepalive job is needed.

## Sync compatibility — hard rules

1. **No new migrations.** A fork-only migration writes a row into the budget file's
   `__migrations__` table, which is uploaded whole (`cloud-storage.ts`).
   `checkDatabaseValidity` (`loot-core/src/server/migrate/migrations.ts`) matches applied
   IDs to the on-disk list _by position_, so every vanilla client then hits
   `out-of-sync-migrations`.
2. **No new tables and no new columns.** CRDT messages are applied as raw SQL
   (`loot-core/src/server/sync/index.ts`); a vanilla client receiving a message naming an
   unknown table or column throws `invalid-schema`.
3. **Never emit CRDT messages for fork-only datasets.** Corollary of (2).
4. **Persist through existing channels only:**
   - Synced, cross-device: the free-form `preferences` store via `preferences/save` /
     `preferences/get` (`loot-core/src/server/preferences/app.ts` reads with no key
     whitelist, so unknown keys are inert in vanilla). Namespace keys as `fork.*`.
   - Dashboard layout: a new widget `type` string plus JSON in the existing
     `dashboard.meta` column.
   - Local-only: metadata prefs (`save-prefs`) / global prefs (`save-global-prefs`).
5. **Never touch `SYNC_FORMAT_VERSION`** (`sync-server/src/app-sync/validation.js`) or the
   `X-ACTUAL-FORMAT` header (`loot-core/src/server/cloud-storage.ts`).
6. **Don't modify the `sync-server` package.** PikaPods runs vanilla; changes here are dead
   code that only add merge conflicts.
7. **Additive-only**, per upstream's own policy in `ci-actions/bin/check-migrations.ts`:
   no DROP, no RENAME, nothing removed.
8. **Never write `goal` / `long_goal` as a side effect of viewing the budget.** Derived
   targets are computed in memory and cached client-side only. Writing them would emit sync
   messages and silently mutate the shared file.

### Migration direction is the real trap

Nothing stops a _newer_ vanilla client from migrating the file forward. If the PikaPods
server image is newer than this fork's merge point and you open the budget in its web UI,
it applies its migrations to `db.sqlite`; this client, with a shorter on-disk migration
list, then trips `out-of-sync-migrations`.

**Rule: the fork must never be behind any other client that touches the budget.** When you
upgrade the PikaPods image, merge upstream and rebuild the fork _first_.

## Keeping merges cheap

1. New code in **new directories** only — new files never conflict.
2. **Fork tooling as new files, never edits** (`bin/fork-build-mac`,
   `.github/workflows/fork-desktop.yml`). Do not edit `bin/package-electron` or any
   existing workflow.
3. Touch existing files in the fewest, smallest, **last-line-most** places.
4. **Never run `yarn lint:fix` / `oxfmt` repo-wide** on `fork/main` — it rewrites untouched
   files and generates hundreds of conflict hunks.
5. Avoid new dependencies. On a `yarn.lock` conflict take upstream's wholesale
   (`git checkout --theirs yarn.lock`), then `yarn install` and commit the regenerated lock.
6. **Don't edit `packages/desktop-electron/package.json`.** Upstream bumps its `version` on
   every release. Select build targets on the electron-builder CLI instead
   (`yarn electron-builder --mac dmg:arm64`), and stamp the fork version at build time.

## Building the desktop app

### One-time toolchain

Node **24** (`.nvmrc` pins v24.18.1). The system node is 26, which is untested
here and ships no corepack, so use the keg-only Homebrew install:

```bash
brew install node@24
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
corepack enable
yarn install --immutable
```

Xcode and `python3` + `setuptools` must be present (node-gyp builds
better-sqlite3, bcrypt and argon2).

### macOS (locally)

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
bin/fork-build-mac              # arm64 only, ~10-15 min
bin/fork-build-mac --universal  # both arches, ~2x
```

Run `yarn build:desktop` once instead if you want non-English locales — it
clones `actualbudget/translations` into `packages/desktop-client/locale`, which
`bin/fork-build-mac` deliberately skips. Without it the UI is English-only,
which breaks nothing.

Install:

```bash
rm -rf /Applications/Actual.app
cp -R packages/desktop-electron/dist/mac-arm64/Actual.app /Applications/
```

> **After any desktop build, `yarn test` will fail** until you run
> `yarn rebuild better-sqlite3`. The build's `beforePackHook` recompiles
> better-sqlite3, bcrypt and argon2 against Electron's Node ABI
> (`NODE_MODULE_VERSION 148`), and plain-Node vitest needs the Node ABI (137).
> The symptom is every DB-backed test failing in `src/mocks/setup.ts` with
> "This version of Node.js requires NODE_MODULE_VERSION 137". Nothing is
> actually broken — just rebuild and re-run.

A locally built app launches with no prompt: it is ad-hoc signed (required on
Apple Silicon) and carries no quarantine attribute, so Gatekeeper never runs its
notarization check. Confirm the signature after a first build on a new machine:

```bash
codesign -dv --verbose=4 /Applications/Actual.app 2>&1 | grep -i signature
# expect: Signature=adhoc
```

If it reports "not signed at all", the `afterSign` hook did not fire — sign it
by hand with `codesign --sign - --force --deep /Applications/Actual.app`.

### Windows

**Cross-building Windows from macOS does not work.** `beforePackHook.ts` calls
`@electron/rebuild`, which has an `arch` option but no `platform` option — it
always compiles native modules for the _host_, so a "Windows" build made on a
Mac would ship Mach-O `.node` binaries and crash as soon as loot-core loads
better-sqlite3. Docker/Wine images hit the same wall.

Use the `Fork Desktop Build` workflow (`.github/workflows/fork-desktop.yml`)
instead: run it from the Actions tab, or push a `fork-v*` tag.

### Installing a downloaded build

macOS marks anything a browser downloaded with `com.apple.quarantine`, and on
macOS 15+ an unnotarized app shows _"Apple could not verify…"_ with no Open
option — the old Control-click → Open bypass no longer works. Either use
**System Settings → Privacy & Security → Open Anyway**, or:

```bash
xattr -d com.apple.quarantine ~/Downloads/Actual-mac-arm64.dmg
```

then drag to /Applications and, if needed,
`xattr -dr com.apple.quarantine /Applications/Actual.app`.

Windows: `Unblock-File -Path .\Actual-windows-x64.exe`, then SmartScreen →
**More info → Run anyway**. This reappears for every new build; only an EV
certificate avoids it.

### CI

`.github/workflows/fork-desktop.yml` builds mac + windows on GitHub-hosted
runners. Every upstream workflow targets Depot runners and will hang in this
fork, so disable them once (no file edits, so nothing to conflict on a merge):

```bash
gh workflow list --all --limit 200 --json id -q '.[].id' | xargs -n1 gh workflow disable
gh workflow enable "Fork Desktop Build"
gh workflow enable "Fork Upstream Sync"
```

Newly added upstream workflows arrive enabled after each merge, so
`Fork Upstream Sync` re-disables everything outside its allowlist on every run
(see _Staying in sync with upstream_) — you no longer have to remember. Spot-check
with `gh workflow list --all` if a hung job ever appears.

Tag fork releases `fork-v*`, never `v*`: a `v*` tag fires upstream's release
workflows, including `publish-npm-packages.yml`, whose guard
(`github.event_name == 'push' || repository.fork == false`) still lets it run on a
tag push in a fork.

### Versioning

Builds stamp `<upstream version>-fork.<UTC timestamp>` at build time and revert
the change afterwards, so `packages/desktop-electron/package.json` stays clean
(upstream bumps its `version` every release). `parseSemanticVersion` truncates
the suffix, so the fork compares equal to the upstream release it was built
from: no false "you're outdated" nag, but you still get notified when upstream
ships a new version. Settings → _Client version_ shows the full string.
