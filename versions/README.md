# Versions — going back to an earlier website

Every saved version exists in **two places**:

| Where | What | Survives if this PC dies? |
|---|---|---|
| `versions\snapshots\<date>.zip` | Full copy of the project, on this computer | No |
| GitHub tag `v<date>` | The same version, stored on GitHub | Yes |

The zips are not uploaded to GitHub (they're in `.gitignore`), so the
repository stays small. The GitHub tags are the online backup.

## Save a version
Double-click **`save-version.bat`** in this folder and type a short
description. Do this **before** any risky change, and after any change
you're happy with. Each save is listed in [CHANGELOG.md](CHANGELOG.md).

## Go back to a version (on this computer)
1. Double-click **`restore-version.bat`**.
2. Type the version name from the list (e.g. `2026-10-26_1430`).
   Your current files are saved first as `before-restore_<date>.zip`,
   so you can undo the restore the same way.
3. Check the site, then run **`sync.bat`** to publish it.

## Go back to a version (from GitHub, e.g. on another computer)
1. Open https://github.com/glenn925/magnumcpa-website/tags
2. Click the version, then **Download ZIP**, and unzip it over the
   project folder.
3. Run `sync.bat` to publish.

Or in a terminal: `git checkout v2026-10-26_1430 -- .` then `sync.bat`.

## Notes
- Restoring does not delete files that were created after that version.
- Never delete the `CNAME` file — it connects the site to magnumcpa.com.
- `versions/` is not published on the live website (see `_config.yml`).
