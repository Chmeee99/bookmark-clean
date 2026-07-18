# ADR 0009: Require an owner-controlled SQLite path

Status: accepted
Date: 2026-07-16

## Context

Bookmark Clean stores private bookmark titles, URLs, and derived observations in
a local SQLite database. The current opener creates and tightens the main file to
POSIX mode `0600`, but a final-component symlink is followed and a hostile parent
directory can replace the path before SQLite opens it.

The current product is a single-user local CLI on macOS. Multi-user installation,
background services under another account, shared storage, and encrypted storage
are not current capabilities.

## Decision

File-backed databases are supported only in an existing directory that is owned
by the current effective user and is not writable by group or other users.

Before SQLite opens the path, the shared private-file helper:

- opens the parent directory and validates that it is a directory owned by the
  current user with no group/world write bits;
- opens or creates the database with `O_NOFOLLOW`, `O_CREAT`, `O_RDWR`, and mode
  `0600`;
- validates from the opened descriptor that the target is a regular,
  current-user-owned, single-link file;
- tightens the descriptor to mode `0600`; and
- closes every descriptor on success or failure.

`:memory:` remains supported without filesystem checks. Both public SQLite
sessions return their existing `storage_unavailable` open failure when the path
does not satisfy this boundary.

## Residual risk

Node does not expose the `openat`-style directory-relative sequence needed to
close every hostile ancestor replacement race. The accepted single-user boundary
therefore requires an owner-controlled directory for the lifetime of the open.
Database encryption, secure deletion, encrypted backups, shared directories,
network filesystems, and execution under another account require a new
distribution threat model before support.
