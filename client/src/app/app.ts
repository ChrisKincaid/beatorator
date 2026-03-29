import { Component, signal, computed, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, Track, Stats } from './api.service';
import { TagMode } from './tag-mode/tag-mode';
import { ExportMode } from './export-mode/export-mode';

@Component({
  selector: 'app-root',
  imports: [CommonModule, TagMode, ExportMode],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  appMode = signal<'sort' | 'tag' | 'export'>('sort');
  tracks = signal<Track[]>([]);
  currentIndex = signal(0);
  stats = signal<Stats | null>(null);
  isPlaying = signal(false);
  isLoading = signal(false);
  isRating = signal(false);
  showStats = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  ratingFeedback = signal<string | null>(null);
  loopMode = signal(false);
  skippedBack = signal(false);
  playlistSource = signal<string>('inbox'); // 'inbox' or a rating name like 'Banger'

  currentTrack = computed(() => {
    const t = this.tracks();
    const i = this.currentIndex();
    return t.length > 0 && i < t.length ? t[i] : null;
  });

  trackName = computed(() => {
    const track = this.currentTrack();
    if (!track) return 'No tracks';
    // Remove extension for display
    return track.filename.replace(/\.[^/.]+$/, '');
  });

  remainingCount = computed(() => this.tracks().length);

  streamUrl = computed(() => {
    const track = this.currentTrack();
    if (!track) return '';
    const source = this.playlistSource();
    if (source === 'inbox') {
      return this.api.getStreamUrl(track.filename);
    }
    return this.api.getRatedStreamUrl(source, track.filename);
  });

  progress = computed(() => {
    const d = this.duration();
    if (d === 0) return 0;
    return (this.currentTime() / d) * 100;
  });

  @ViewChild('audioPlayer') audioRef!: ElementRef<HTMLAudioElement>;

  ratings = ['Bad', 'OK', 'Good', 'Real Good', 'Banger'];
  ratingEmojis: Record<string, string> = {
    'Bad': '👎',
    'OK': '😐',
    'Good': '👍',
    'Real Good': '🔥',
    'Banger': '💥'
  };

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadTracks();
  }

  switchMode(mode: 'sort' | 'tag' | 'export') {
    if (mode !== 'sort') {
      const audio = this.audioRef?.nativeElement;
      if (audio) {
        audio.pause();
        this.isPlaying.set(false);
      }
    }
    this.appMode.set(mode);
  }

  loadTracks() {
    this.isLoading.set(true);
    this.playlistSource.set('inbox');
    this.api.getTracks().subscribe({
      next: (tracks) => {
        // Shuffle for random playback
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
        this.tracks.set(tracks);
        this.currentIndex.set(0);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false)
    });
    this.api.getStats().subscribe({
      next: (stats) => this.stats.set(stats)
    });
  }

  loadRatedTracks(rating: string) {
    const audio = this.audioRef?.nativeElement;
    if (audio) {
      audio.pause();
      this.isPlaying.set(false);
    }

    this.isLoading.set(true);
    this.playlistSource.set(rating);
    this.api.getRatedTracks(rating).subscribe({
      next: (tracks) => {
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
        this.tracks.set(tracks);
        this.currentIndex.set(0);
        this.isLoading.set(false);
        this.showStats.set(false);
        this.autoPlayCurrent();
      },
      error: () => this.isLoading.set(false)
    });
  }

  togglePlay() {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;

    if (audio.paused) {
      audio.play();
      this.isPlaying.set(true);
    } else {
      audio.pause();
      this.isPlaying.set(false);
    }
  }

  onTimeUpdate(event: Event) {
    const audio = event.target as HTMLAudioElement;
    this.currentTime.set(audio.currentTime);
    this.duration.set(audio.duration || 0);
  }

  onEnded() {
    if (this.loopMode()) {
      const audio = this.audioRef?.nativeElement;
      if (audio) {
        audio.currentTime = 0;
        audio.play().then(() => this.isPlaying.set(true)).catch(() => {});
      }
      return;
    }
    this.isPlaying.set(false);
    this.skip();
  }

  stop() {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    this.isPlaying.set(false);
  }

  seek(event: MouseEvent) {
    const audio = this.audioRef?.nativeElement;
    if (!audio || !audio.duration) return;

    const bar = event.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const pct = (event.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  }

  skip() {
    const audio = this.audioRef?.nativeElement;
    if (audio) {
      audio.pause();
      this.isPlaying.set(false);
    }

    this.skippedBack.set(false);
    const nextIndex = this.currentIndex() + 1;
    if (nextIndex < this.tracks().length) {
      this.currentIndex.set(nextIndex);
      this.autoPlayCurrent();
    }
  }

  back() {
    const prevIndex = this.currentIndex() - 1;
    if (prevIndex < 0) return;

    const audio = this.audioRef?.nativeElement;
    if (audio) {
      audio.pause();
      this.isPlaying.set(false);
    }

    this.skippedBack.set(true);
    this.currentIndex.set(prevIndex);
    this.autoPlayCurrent();
  }

  toggleLoop() {
    this.loopMode.update(v => !v);
  }

  rate(rating: string) {
    const track = this.currentTrack();
    if (!track || this.isRating()) return;

    const source = this.playlistSource();

    // If re-rating to the same folder, skip (no-op)
    if (source !== 'inbox' && source === rating) return;

    this.isRating.set(true);
    this.ratingFeedback.set(rating);

    const audio = this.audioRef?.nativeElement;
    if (audio) {
      audio.pause();
      this.isPlaying.set(false);
    }

    const rateObs = source === 'inbox'
      ? this.api.rateTrack(track.filename, rating)
      : this.api.reRateTrack(source, track.filename, rating);

    rateObs.subscribe({
      next: () => {
        // Remove the rated track from the list
        const updated = this.tracks().filter((_, i) => i !== this.currentIndex());
        this.tracks.set(updated);

        // Keep current index (next track slides in), or clamp
        if (this.currentIndex() >= updated.length && updated.length > 0) {
          this.currentIndex.set(updated.length - 1);
        }

        // Refresh stats
        this.api.getStats().subscribe({
          next: (stats) => this.stats.set(stats)
        });

        this.isRating.set(false);

        // Auto-play next track after a brief delay
        setTimeout(() => {
          this.ratingFeedback.set(null);
          this.autoPlayCurrent();
        }, 800);
      },
      error: () => {
        this.isRating.set(false);
        this.ratingFeedback.set(null);
      }
    });
  }

  autoPlayCurrent() {
    const audio = this.audioRef?.nativeElement;
    if (!audio || !this.currentTrack()) return;
    // Small delay to let Angular update the src binding
    setTimeout(() => {
      audio.play().then(() => this.isPlaying.set(true)).catch(() => {});
    }, 100);
  }

  toggleStats() {
    this.showStats.update(v => !v);
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
