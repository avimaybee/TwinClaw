# Conductor Consistency Check Procedure

This document defines the repeatable checklist for verifying registry-to-artifact consistency in the Conductor track system. It should be run before any track is archived and as part of periodic maintenance reviews.

---

## Frequency
- **Before archiving any track:** Run Section A (single-track check).
- **Periodic review (monthly or when new tracks are batch-created):** Run all sections.

---

## Section A: Single-Track Completion Check

Before archiving a track, verify the following:

- [ ] The track folder exists at `conductor/tracks/<track_id>/`
- [ ] `spec.md` is present and accurate to the delivered implementation
- [ ] `plan.md` is present and all tasks are marked `[x]`
- [ ] `metadata.json` is present with:
  - `"status": "completed"` (or the appropriate terminal status)
  - `updated_at` timestamp reflects the completion date
  - `description` matches the track's implemented purpose
- [ ] The entry in `conductor/tracks.md` is marked `[x]`
- [ ] The link in `tracks.md` resolves to the correct folder path

---

## Section B: Registry-to-Artifact Audit

Run this to detect drift between `tracks.md` and the filesystem:

```powershell
# 1. List all track folder IDs referenced in tracks.md
Select-String -Path "conductor/tracks.md" -Pattern '\./tracks/[^/]+' -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique

# 2. List all actual folders in conductor/tracks/
Get-ChildItem -Path "conductor/tracks/" -Directory | Select-Object -ExpandProperty Name

# 3. List all archive folder IDs referenced in tracks.md
Select-String -Path "conductor/tracks.md" -Pattern '\./archive/[^/]+' -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique

# 4. List all actual folders in conductor/archive/
Get-ChildItem -Path "conductor/archive/" -Directory | Select-Object -ExpandProperty Name
```

**Check for:** References in `tracks.md` that don't have corresponding folders (broken links), and folders that aren't referenced in `tracks.md` (orphans).

---

## Section C: Metadata Completeness Audit

Verify every track folder has a `metadata.json`:

```powershell
# Find archive tracks missing metadata.json
Get-ChildItem -Path "conductor/archive/" -Directory | ForEach-Object {
    $meta = Join-Path $_.FullName "metadata.json"
    if (-not (Test-Path $meta)) { Write-Host "MISSING metadata: $($_.Name)" -ForegroundColor Red }
}

# Find active tracks missing metadata.json
Get-ChildItem -Path "conductor/tracks/" -Directory | ForEach-Object {
    $meta = Join-Path $_.FullName "metadata.json"
    if (-not (Test-Path $meta)) { Write-Host "MISSING metadata: $($_.Name)" -ForegroundColor Red }
}
```

---

## Section D: Plan Checkbox Audit

Verify archived tracks have no incomplete plan items:

```powershell
# Find archive tracks with unchecked items
Get-ChildItem -Path "conductor/archive/" -Directory | ForEach-Object {
    $plan = Join-Path $_.FullName "plan.md"
    if (Test-Path $plan) {
        $content = Get-Content $plan
        $unchecked = $content | Select-String -Pattern '- \[ \]'
        if ($unchecked) {
            Write-Host "UNCHECKED ITEMS ($($unchecked.Count)): $($_.Name)" -ForegroundColor Yellow
        }
    }
}
```

---

## Section E: Status Consistency Audit

Verify metadata statuses are consistent with their location:

```powershell
# Archive tracks should all be "completed"
Get-ChildItem -Path "conductor/archive/" -Directory | ForEach-Object {
    $metaPath = Join-Path $_.FullName "metadata.json"
    if (Test-Path $metaPath) {
        $meta = Get-Content $metaPath | ConvertFrom-Json
        if ($meta.status -ne "completed") {
            Write-Host "WRONG STATUS ($($meta.status)): $($_.Name)" -ForegroundColor Red
        }
    }
}

# Active tracks should not be "completed" (if completed they should be archived)
Get-ChildItem -Path "conductor/tracks/" -Directory | ForEach-Object {
    $metaPath = Join-Path $_.FullName "metadata.json"
    if (Test-Path $metaPath) {
        $meta = Get-Content $metaPath | ConvertFrom-Json
        if ($meta.status -eq "completed") {
            Write-Host "COMPLETED BUT NOT ARCHIVED: $($_.Name)" -ForegroundColor Yellow
        }
    }
}
```

---

## Integration with Track Completion Protocol

When completing a track, the conductor agent MUST:

1. Mark all plan items `[x]` in `plan.md`
2. Update `metadata.json` `"status"` to `"completed"` and `"updated_at"` to current timestamp
3. Update `tracks.md` entry to `[x]`
4. Run Section A check above before archiving
5. Move folder to `conductor/archive/<track_id>/`
6. Update `tracks.md` link to `./archive/<track_id>/`
7. Commit with message: `chore(conductor): Archive track '<track_description>'`

---

## Rationale

Track drift occurs when:
- Tracks are implemented but plan/metadata aren't updated
- Folders are created but not registered in `tracks.md`
- Registry entries reference folders that don't exist
- Metadata statuses are not updated at transition points

This checklist was added as part of `track_status_reconciliation_20260220` after an audit found 26 missing `metadata.json` files, 2 stale statuses, 1 missing active track folder, and 1 unchecked plan item across the conductor archive.
