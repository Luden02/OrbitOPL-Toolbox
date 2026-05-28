import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { LogsService } from './logs.service';
import { LibraryService } from './library.service';

export type ImportJobType = 'ps2-dvd' | 'ps2-cd' | 'ps1' | 'zso' | 'apps';
export type JobStatus = 'queued' | 'running' | 'success' | 'error';

export interface ImportJob {
  id: string;
  type: ImportJobType;
  /** Human-friendly label for the job (game name or id, falls back to filename). */
  label: string;
  filePath: string;
  gameId: string;
  gameName: string;
  downloadArtwork: boolean;
  /** PS1 only: POPStarter device prefix (e.g. "XX." / "SB."). */
  elfPrefix?: string;
  /** ZSO only: remove the source ISO once compression succeeds. */
  deleteOriginal?: boolean;
  /**
   * PS2 DVD only: skip the rename step so the file keeps its original name
   * (OPL "new" naming convention — game ID read from SYSTEM.CNF).
   */
  keepOriginalName?: boolean;
  status: JobStatus;
  percent: number;
  stage: string;
  message?: string;
  createdAt: number;
  finishedAt?: number;
}

export type NewImportJob = Omit<
  ImportJob,
  'id' | 'status' | 'percent' | 'stage' | 'message' | 'createdAt' | 'finishedAt'
>;

/**
 * Owns the import queue. Jobs are processed one at a time (sequentially) — the
 * underlying IPC progress channels are global and unscoped, and serial disk I/O
 * avoids thrashing, so a single in-flight job keeps progress attribution clean.
 */
@Injectable({
  providedIn: 'root',
})
export class JobsService {
  private jobsSubject = new BehaviorSubject<ImportJob[]>([]);
  public get jobs$(): Observable<ImportJob[]> {
    return this.jobsSubject.asObservable();
  }

  public get activeCount$(): Observable<number> {
    return this.jobs$.pipe(
      map(
        (jobs) =>
          jobs.filter((j) => j.status === 'queued' || j.status === 'running')
            .length
      )
    );
  }

  private isProcessing = false;

  constructor(
    private readonly _logger: LogsService,
    private readonly _library: LibraryService
  ) {}

  /** Queue one or more imports and kick the worker if idle. */
  public enqueue(jobs: NewImportJob[]): void {
    const created: ImportJob[] = jobs.map((job) => ({
      ...job,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'queued',
      percent: 0,
      stage: 'Queued',
      createdAt: Date.now(),
    }));
    this.jobsSubject.next([...this.jobsSubject.value, ...created]);
    this._logger.log('jobsService', `Queued ${created.length} import job(s)`);
    void this.processNext();
  }

  /** Remove finished (success/error) jobs from the list. */
  public clearFinished(): void {
    this.jobsSubject.next(
      this.jobsSubject.value.filter(
        (j) => j.status === 'queued' || j.status === 'running'
      )
    );
  }

  /** Remove a single finished or queued (not running) job. */
  public removeJob(id: string): void {
    this.jobsSubject.next(
      this.jobsSubject.value.filter(
        (j) => j.id !== id || j.status === 'running'
      )
    );
  }

  private patchJob(id: string, patch: Partial<ImportJob>): void {
    this.jobsSubject.next(
      this.jobsSubject.value.map((j) =>
        j.id === id ? { ...j, ...patch } : j
      )
    );
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    const next = this.jobsSubject.value.find((j) => j.status === 'queued');
    if (!next) {
      return;
    }

    this.isProcessing = true;
    this.patchJob(next.id, { status: 'running', stage: 'Starting…', percent: 0 });

    try {
      const result = await this.runJob(next);
      if (result?.success) {
        this.patchJob(next.id, {
          status: 'success',
          percent: 100,
          stage: 'Completed',
          finishedAt: Date.now(),
        });
        this._logger.log('jobsService', `Import succeeded: ${next.label}`);
        this._library.refreshGamesFiles();
      } else {
        this.patchJob(next.id, {
          status: 'error',
          stage: 'Failed',
          message: result?.message || 'Import failed',
          finishedAt: Date.now(),
        });
        this._logger.error(
          'jobsService',
          `Import failed for ${next.label}: ${result?.message}`
        );
      }
    } catch (error: any) {
      this.patchJob(next.id, {
        status: 'error',
        stage: 'Failed',
        message: error?.message || String(error),
        finishedAt: Date.now(),
      });
      this._logger.error(
        'jobsService',
        `Import error for ${next.label}: ${error?.message || error}`
      );
    } finally {
      this.isProcessing = false;
      // Process the rest of the queue on the next tick.
      setTimeout(() => void this.processNext(), 0);
    }
  }

  private async runJob(
    job: ImportJob
  ): Promise<{ success: boolean; message?: string }> {
    const dirPath = this._library.currentDirectoryValue;
    if (!dirPath) {
      return { success: false, message: 'No library directory mounted.' };
    }

    switch (job.type) {
      case 'ps2-cd':
        return this.runPs2CdJob(job, dirPath);
      case 'ps1':
        return this.runPs1Job(job, dirPath);
      case 'zso':
        return this.runZsoJob(job);
      case 'apps':
        return this.runAppsJob(job, dirPath);
      case 'ps2-dvd':
      default:
        return this.runPs2DvdJob(job, dirPath);
    }
  }

  private async runAppsJob(job: ImportJob, dirPath: string) {
    this.patchJob(job.id, { stage: 'Copying ELF…', percent: 50 });
    return window.libraryAPI.importApp(dirPath, job.filePath, job.gameName);
  }

  private async runZsoJob(job: ImportJob) {
    const zsoPath = job.filePath.replace(/\.iso$/i, '.zso');
    window.libraryAPI.onZsoCompressProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      })
    );
    try {
      return await window.libraryAPI.compressIsoToZso(
        job.filePath,
        zsoPath,
        job.deleteOriginal ?? true
      );
    } finally {
      window.libraryAPI.removeAllZsoCompressProgressListeners();
    }
  }

  private async runPs2CdJob(job: ImportJob, dirPath: string) {
    window.libraryAPI.onPs2CdImportProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      })
    );
    try {
      return await window.libraryAPI.importPs2CdGame(
        job.filePath,
        dirPath,
        job.gameId,
        job.gameName,
        job.downloadArtwork
      );
    } finally {
      window.libraryAPI.removeAllPs2CdImportProgressListeners();
    }
  }

  private async runPs1Job(job: ImportJob, dirPath: string) {
    window.libraryAPI.onPs1ImportProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      })
    );
    try {
      return await window.libraryAPI.importPs1Game(
        job.filePath,
        dirPath,
        job.elfPrefix || 'XX.',
        job.downloadArtwork
      );
    } finally {
      window.libraryAPI.removeAllPs1ImportProgressListeners();
    }
  }

  private async runPs2DvdJob(job: ImportJob, dirPath: string) {
    const destinationDir = `${dirPath}/DVD`;

    window.libraryAPI.onMoveFileProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: `Copying ${progress.copiedMB}/${progress.totalMB} MB`,
      })
    );

    try {
      this.patchJob(job.id, { stage: 'Copying file…' });
      const moveResult: any = await window.libraryAPI.moveFile(
        job.filePath,
        destinationDir
      );
      if (!moveResult?.success) {
        return {
          success: false,
          message: moveResult?.message || 'Failed to move game file.',
        };
      }

      const movedPath =
        moveResult.newPath ||
        `${destinationDir}/${job.filePath.split(/[\\/]/).pop()}`;

      // Skip the rename in "new OPL convention" mode — OPL will read the
      // game ID from SYSTEM.CNF on its own.
      if (job.keepOriginalName) {
        if (job.downloadArtwork) {
          this.patchJob(job.id, { stage: 'Fetching artwork…', percent: 100 });
          await window.libraryAPI.downloadArtByGameId(
            `${dirPath}/ART`,
            job.gameId,
            'PS2'
          );
        }
        return { success: true };
      }

      this.patchJob(job.id, { stage: 'Renaming…' });
      const renameResult: any = await window.libraryAPI.renameGamefile(
        movedPath,
        job.gameId,
        job.gameName
      );
      if (!renameResult?.success) {
        return {
          success: false,
          message: renameResult?.message || 'Failed to rename game file.',
        };
      }

      if (job.downloadArtwork) {
        this.patchJob(job.id, { stage: 'Fetching artwork…', percent: 100 });
        await window.libraryAPI.downloadArtByGameId(
          `${dirPath}/ART`,
          job.gameId,
          'PS2'
        );
      }

      return { success: true };
    } finally {
      window.libraryAPI.removeAllMoveFileProgressListeners();
    }
  }
}
