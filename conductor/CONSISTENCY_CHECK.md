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

```bash
# 1. List all track folder IDs referenced in tracks.md
grep -oP '\./tracks/[^/]+' conductor/tracks.md | sort -u

# 2. List all actual folders in conductor/tracks/
ls conductor/tracks/

# 3. List all archive folder IDs referenced in tracks.md
grep -oP '\./archive/[^/]+' conductor/tracks.md | sort -u

# 4. List all actual folders in conductor/archive/
ls conductor/archive/
```

**Check for:** References in `tracks.md` that don't have corresponding folders (broken links), and folders that aren't referenced in `tracks.md` (orphans).

---

## Section C: Metadata Completeness Audit

Verify every track folder has a `metadata.json`:

```bash
# Find archive tracks missing metadata.json
for d in conductor/archive/*/; do
  [ ! -f "$d/metadata.json" ] && echo "MISSING metadata: $d"
done

# Find active tracks missing metadata.json
for d in conductor/tracks/*/; do
  [ ! -f "$d/metadata.json" ] && echo "MISSING metadata: $d"
done
```

---

## Section D: Plan Checkbox Audit

Verify archived tracks have no incomplete plan items:

```bash
# Find archive tracks with unchecked items
for d in conductor/archive/*/; do
  count=$(grep -c '\- \[ \]' "$d/plan.md" 2>/dev/null || echo 0)
  [ "$count" -gt 0 ] && echo "UNCHECKED ITEMS ($count): $d"
done
```

---

## Section E: Status Consistency Audit

Verify metadata statuses are consistent with their location:

```bash
# Archive tracks should all be "completed"
for d in conductor/archive/*/; do
  status=$(python3 -c "import json,sys; d=json.load(open('$d/metadata.json')); print(d['status'])" 2>/dev/null)
  [ "$status" != "completed" ] && echo "WRONG STATUS ($status): $d"
done

# Active tracks should not be "completed" (if completed they should be archived)
for d in conductor/tracks/*/; do
  status=$(python3 -c "import json,sys; d=json.load(open('$d/metadata.json')); print(d['status'])" 2>/dev/null)
  [ "$status" = "completed" ] && echo "COMPLETED BUT NOT ARCHIVED: $d"
done
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
