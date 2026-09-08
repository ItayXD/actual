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

### The one-time GitHub settings

None of these is code, and the workflow cannot do any of them for itself. All three are
already applied — this records what they are and why, since none is discoverable from the
repo.

1. **The default branch must be `fork/main`.** GitHub runs `schedule` and
   `workflow_dispatch` only from the default branch, and `master` here is a pristine
   mirror that must never be committed to — so the workflow can only live on `fork/main`.
   Settings → General → Default branch.
2. **Enable the workflow.** Scheduled workflows are disabled by default in a fork:
   `gh workflow enable "Fork Upstream Sync"`, or the Actions tab. This fork is **public**,
   so the 60-day inactivity auto-disable applies: GitHub turns a scheduled workflow off
   after 60 days with no repository activity, and emails the owner. A landed sync is a
   commit, so monthly releases keep the timer reset by themselves — but a sync left
   conflicted and unmerged for two months will stop the schedule until you re-enable it.
3. **Allow Actions to create pull requests.** Settings → Actions → General → Workflow
   permissions → _Allow GitHub Actions to create and approve pull requests_
   (`can_approve_pull_request_reviews`). Without it `gh pr create` fails with
   `Resource not accessible by integration`. `default_workflow_permissions` is
   deliberately left at **read** — the workflow declares the writes it needs in its own
   `permissions:` block, which is enough (its pushes worked while the repo default was
   read).

Watch out for two traps that cost a run each when this was first switched on:

- **`gh` defaults to the parent repo in a fork.** An unqualified `gh pr create` or
  `gh workflow disable` inside the fork targets `actualbudget/actual`. The workflow sets
  `GH_REPO: ${{ github.repository }}` once in its job env to prevent that; do not remove
  it, and pass `-R ItayXD/actual` when running `gh` against the fork by hand.
- **Switching the default branch to `fork/main` registered all 41 workflow files, every
  one enabled** — GitHub had only known about the 2 present on `master`. That briefly put
  `publish-npm-packages`, `docker-release`, `netlify-release`, `electron-master`,
  `publish-flathub`, `publish-microsoft-store`, `publish-crdt` and
  `publish-nightly-electron` in play. Re-check with
  `gh workflow list --all -R ItayXD/actual` after any change to the default branch.

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
3. Touch existing files in the fewest, smallest places, in one contiguous block.
   Position is **not** a reliable defence: upstream inserts at both ends of its own
   lists — in 26.9.0 it added `newSidebarUI` to the _top_ of the `FeatureFlag` union
   while appending to `GlobalPrefs` at the bottom. Whether relocating a registration
   helps is empirical; measure it with the recipe below instead of assuming.
4. **Never run `yarn lint:fix` / `oxfmt` repo-wide** on `fork/main` — it rewrites untouched
   files and generates hundreds of conflict hunks.
5. Avoid new dependencies. `bin/fork-sync` resolves a `yarn.lock` conflict for you (take
   upstream's wholesale, then `yarn install`); by hand it is
   `git checkout --theirs yarn.lock && yarn install`.
6. **Don't edit `packages/desktop-electron/package.json`.** Upstream bumps its `version` on
   every release. Select build targets on the electron-builder CLI instead
   (`yarn electron-builder --mac dmg:arm64`), and stamp the fork version at build time.

### Where the conflicts actually come from

Measured on 2026-09-08, per file, against upstream's real changes since each past
release (the recipe is below; counts are conflicting hunks after the relocations):

| upstream changes since | conflicts before | after |
| ---------------------- | ---------------- | ----- |
| 26.8.1 (86 commits)    | 1                | 1     |
| 26.8.0 (109 commits)   | 6                | 4     |
| 26.7.0 (198 commits)   | 8                | 4     |

Two things fall out of that:

- **A release cycle's worth of churn is cheap.** One month collides on ~1 file; skipping
  a month multiplies it several times over. Syncing on every release is the cheap
  cadence — letting two or three pile up is what makes a merge painful.
- **Not one conflict was in the fork's own logic.** Every recurring one is a
  _registration_ edit — adding a feature flag to a union, a widget type to a list, a route,
  a nav row, a dashboard card. The fork's real work (`goal-template.ts`,
  `category-template-context.ts`, the `plan/` and `targets/` directories) never conflicted,
  because it lives in new files or in regions upstream does not touch.

`.fork-hotspots` lists those registration points and what the fork registers at each.
`bin/fork-sync` and the sync PR both use it to split a conflict list into "routine
boilerplate, same resolution as last month" and "upstream changed something the fork's
logic rests on" — the second is the only kind worth slowing down for.

### Measuring it yourself, per file

This conflicts exactly when the fork's hunks overlap upstream's, which is what a 3-way
merge tests — no rebasing, no scratch clone:

```bash
R=ecf069d35   # a past release commit on master
F=packages/loot-core/src/types/prefs.ts
git merge-file -q -p <(git show "$R:$F") <(git show db1b0ea97:"$F") \
  <(git show fork/main:"$F") | grep -c '^<<<<<<<'
```

Moving the two dashboard widget lists to the front of their arrays took them from 1
conflict to 0 in every window tested, and `Overview.tsx` from 3 to 1. The identical move
applied to the `FeatureFlag` union made it _worse_ — which is how the "put it first" rule
got retired. Measure before believing.

What remains in a normal month is `FinancesApp.tsx`, and it is a single **import line**:
`oxfmt` sorts imports, so the fork's `./plan/PlanRoute` lands in a region upstream also
adds to. One line, one obvious resolution — exactly what `rerere` replays.

The only thing that removes a conflict _entirely_ is the fork adding **zero** lines to the
file. That is why rule 1 ("new code in new directories") carries most of the weight here,
and why the fork's actual logic has never conflicted.

`git rerere` is already enabled here, which is what makes the remaining collisions cheap:
it records each resolution and replays it the next time the same conflict appears. Check it
survived with `git config --get rerere.enabled`. Its cache is local to this clone, so CI
cannot use it — CI may report a conflict your machine then resolves by itself.

### Unattended merges

`Fork Upstream Sync` merges the PR itself when the merge is clean **and** the compat gate,
`check-migrations`, typecheck, lint and the whole test suite pass — so an uneventful
release lands with nobody looking at it. Anything else stops and waits: a conflict, a
failing check, a compat-gate rejection.

That direction is the safe one. The hard rule is that this fork must never be _behind_
another client touching the budget file, so a validated merge left sitting is itself the
risk.

Validation runs with the dependency and Lage caches **off** (`cache: 'false'`,
`yarn test:debug`). A restored Lage cache can cache-_skip_ a whole package instead of
testing it — locally `yarn test` skips `@actual-app/web` outright — and a verdict that
merges code unattended must not rest on that. To take one release manually, dispatch the
workflow with `auto_merge` unchecked.

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
