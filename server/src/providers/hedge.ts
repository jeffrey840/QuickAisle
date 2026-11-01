/**
 * Hedged requests: start the primary now, start the backup if the primary
 * hasn't answered within delayMs. First fulfillment wins; the loser is
 * aborted. A primary failure worth retrying over (fallbackable, or Meta
 * 401/403 when the route allows auth fallback) starts the backup
 * immediately instead of waiting for the timer.
 */

export interface HedgedOutcome<T> {
  value: T;
  winner: "primary" | "backup";
  backupStarted: boolean;
}

export async function hedged<T>(
  startPrimary: (signal: AbortSignal) => Promise<T>,
  startBackup: (signal: AbortSignal) => Promise<T>,
  delayMs: number,
  /** primary error worth hedging over (else fail loud immediately) */
  isWorthy: (e: unknown) => boolean,
): Promise<HedgedOutcome<T>> {
  return new Promise<HedgedOutcome<T>>((resolve, reject) => {
    const primaryCtrl = new AbortController();
    const backupCtrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let backupStarted = false;
    let backupDone = false;
    let primaryFailedWorthy = false;

    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const win = (value: T, winner: "primary" | "backup"): void => {
      if (settled) return;
      settled = true;
      cleanup();
      (winner === "primary" ? backupCtrl : primaryCtrl).abort();
      resolve({ value, winner, backupStarted });
    };
    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      primaryCtrl.abort();
      backupCtrl.abort();
      reject(e);
    };
    const onBackupDone = (e: unknown): void => {
      backupDone = true;
      // Backup lost the race but the primary is still running: keep
      // waiting for it. If the primary already failed worthy, both
      // failed — surface the backup error (mirrors sequential fallback).
      if (primaryFailedWorthy) fail(e);
    };
    const startBackupNow = (): void => {
      if (backupStarted || settled) return;
      backupStarted = true;
      startBackup(backupCtrl.signal).then(
        (v) => win(v, "backup"),
        onBackupDone,
      );
    };

    timer = setTimeout(startBackupNow, delayMs);
    startPrimary(primaryCtrl.signal).then(
      (v) => win(v, "primary"),
      (e) => {
        if (!isWorthy(e)) {
          fail(e);
          return;
        }
        // Worthy failure: backup already lost → both failed, surface the
        // primary error; else start the backup now and wait for it.
        if (backupDone) {
          fail(e);
          return;
        }
        primaryFailedWorthy = true;
        cleanup();
        startBackupNow();
      },
    );
  });
}
