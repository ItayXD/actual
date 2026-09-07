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

## Sync compatibility — hard rules

1. **No new migrations.** A fork-only migration writes a row into the budget file's
   `__migrations__` table, which is uploaded whole (`cloud-storage.ts`).
   `checkDatabaseValidity` (`loot-core/src/server/migrate/migrations.ts`) matches applied
   IDs to the on-disk list *by position*, so every vanilla client then hits
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

Nothing stops a *newer* vanilla client from migrating the file forward. If the PikaPods
server image is newer than this fork's merge point and you open the budget in its web UI,
it applies its migrations to `db.sqlite`; this client, with a shorter on-disk migration
list, then trips `out-of-sync-migrations`.

**Rule: the fork must never be behind any other client that touches the budget.** When you
upgrade the PikaPods image, merge upstream and rebuild the fork *first*.

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
always compiles native modules for the *host*, so a "Windows" build made on a
Mac would ship Mach-O `.node` binaries and crash as soon as loot-core loads
better-sqlite3. Docker/Wine images hit the same wall.

Use the `Fork Desktop Build` workflow (`.github/workflows/fork-desktop.yml`)
instead: run it from the Actions tab, or push a `fork-v*` tag.

### Installing a downloaded build

macOS marks anything a browser downloaded with `com.apple.quarantine`, and on
macOS 15+ an unnotarized app shows *"Apple could not verify…"* with no Open
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
```

Re-check `gh workflow list` after each upstream merge — newly added upstream
workflows arrive enabled. Tag fork releases `fork-v*`, never `v*`: a `v*` tag
fires upstream's release workflows, including `publish-npm-packages.yml`, whose
guard still lets it run on a tag push in a fork.

### Versioning

Builds stamp `<upstream version>-fork.<UTC timestamp>` at build time and revert
the change afterwards, so `packages/desktop-electron/package.json` stays clean
(upstream bumps its `version` every release). `parseSemanticVersion` truncates
the suffix, so the fork compares equal to the upstream release it was built
from: no false "you're outdated" nag, but you still get notified when upstream
ships a new version. Settings → *Client version* shows the full string.
