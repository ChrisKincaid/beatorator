import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, ExportStatus } from '../api.service';

@Component({
  selector: 'app-export-mode',
  imports: [CommonModule],
  templateUrl: './export-mode.html',
  styleUrl: './export-mode.scss'
})
export class ExportMode implements OnInit, OnDestroy {
  ffmpegAvailable = signal<boolean | null>(null); // null = checking
  status = signal<ExportStatus | null>(null);
  exportState = signal<'idle' | 'running' | 'done' | 'error'>('idle');

  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.checkFfmpeg().subscribe({
      next: (res) => {
        this.ffmpegAvailable.set(res.available);
        // If a job was already running (e.g. page reload mid-export), resume polling
        if (res.available) {
          this.api.getExportStatus().subscribe({
            next: (s) => {
              if (s.running) {
                this.status.set(s);
                this.exportState.set('running');
                this.startPolling();
              } else if (s.finished && s.done > 0) {
                this.status.set(s);
                this.exportState.set(s.failed > 0 ? 'error' : 'done');
              }
            }
          });
        }
      },
      error: () => this.ffmpegAvailable.set(false)
    });
  }

  ngOnDestroy() {
    this.stopPolling();
  }

  startExport() {
    if (this.exportState() === 'running') return;
    this.exportState.set('running');
    this.status.set(null);

    this.api.startExport().subscribe({
      next: () => this.startPolling(),
      error: () => this.exportState.set('error')
    });
  }

  reset() {
    this.stopPolling();
    this.exportState.set('idle');
    this.status.set(null);
  }

  progressPercent(): number {
    const s = this.status();
    if (!s || s.total === 0) return 0;
    return Math.round((s.done / s.total) * 100);
  }

  private startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => {
      this.api.getExportStatus().subscribe({
        next: (s) => {
          this.status.set(s);
          if (s.finished) {
            this.stopPolling();
            this.exportState.set(s.failed > 0 ? 'error' : 'done');
          }
        }
      });
    }, 1000);
  }

  private stopPolling() {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
