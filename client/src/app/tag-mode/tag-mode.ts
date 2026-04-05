import { Component, signal, computed, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Track, TrackMetadata, Stats } from '../api.service';

@Component({
  selector: 'app-tag-mode',
  imports: [CommonModule, FormsModule],
  templateUrl: './tag-mode.html',
  styleUrl: './tag-mode.scss'
})
export class TagMode implements OnInit {
  stats = signal<Stats | null>(null);
  selectedRating = signal<string | null>(null);
  tracks = signal<Track[]>([]);
  taggedFiles = signal<string[]>([]);
  selectedTrack = signal<Track | null>(null);
  metadata = signal<TrackMetadata | null>(null);
  isLoading = signal(false);
  isSaving = signal(false);
  saveMessage = signal<string | null>(null);
  availableImages = signal<string[]>([]);

  // Audio player
  @ViewChild('tagAudio') audioRef!: ElementRef<HTMLAudioElement>;
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);

  audioSrc = computed(() => {
    const track = this.selectedTrack();
    const rating = this.selectedRating();
    if (!track || !rating) return '';
    return this.api.getRatedStreamUrl(rating, track.filename);
  });

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  togglePlay() {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;
    if (audio.paused) { audio.play(); } else { audio.pause(); }
  }

  onTimeUpdate() {
    this.currentTime.set(this.audioRef.nativeElement.currentTime);
  }

  onLoadedMetadata() {
    this.duration.set(this.audioRef.nativeElement.duration);
  }

  onEnded() {
    this.isPlaying.set(false);
    this.currentTime.set(0);
  }

  onPlayPauseChange(playing: boolean) {
    this.isPlaying.set(playing);
  }

  seek(event: Event) {
    const input = event.target as HTMLInputElement;
    const audio = this.audioRef?.nativeElement;
    if (audio && audio.duration) {
      audio.currentTime = (parseFloat(input.value) / 100) * audio.duration;
    }
  }

  // Editable form fields
  artist = signal('');
  title = signal('');
  album = signal('');
  year = signal('');
  genre = signal('');
  trackNumber = signal('');
  composer = signal('');
  publisher = signal('');
  comment = signal('');
  radioStationUrl = signal('');
  embedArt = signal(true);
  selectedArtFilename = signal<string | null>(null); // null = use auto-detected

  ratings = ['Bad', 'OK', 'Good', 'Real Good', 'Banger'];
  ratingEmojis: Record<string, string> = {
    'Bad': '👎', 'OK': '😐', 'Good': '👍', 'Real Good': '🔥', 'Banger': '💥'
  };

  // The art file currently in use (selected override > auto-detected > default)
  effectiveArtFile = computed(() => {
    const meta = this.metadata();
    if (!meta) return '';
    return this.selectedArtFilename() || meta.albumArt || meta.defaultArt;
  });

  albumArtUrl = computed(() => {
    const artFile = this.effectiveArtFile();
    return artFile ? this.api.getImageUrl(artFile) : '';
  });

  // URL for art currently embedded inside the MP3 file itself
  embeddedArtUrl = computed(() => {
    const meta = this.metadata();
    const track = this.selectedTrack();
    const rating = this.selectedRating();
    if (!meta?.current.hasEmbeddedArt || !track || !rating) return '';
    return this.api.getEmbeddedArtUrl(rating, track.filename);
  });

  taggedCount = computed(() => this.taggedFiles().length);

  untaggedCount = computed(() => {
    return this.tracks().filter(t => !this.taggedFiles().includes(t.filename)).length;
  });

  constructor(public api: ApiService) {}

  ngOnInit() {
    this.loadStats();
    this.api.getImages().subscribe({
      next: (imgs) => this.availableImages.set(imgs)
    });
  }

  loadStats() {
    this.api.getStats().subscribe({
      next: (stats) => this.stats.set(stats)
    });
  }

  selectRating(rating: string) {
    this.selectedRating.set(rating);
    this.selectedTrack.set(null);
    this.metadata.set(null);
    this.isLoading.set(true);

    this.api.getRatedTracks(rating).subscribe({
      next: (tracks) => {
        this.tracks.set(tracks);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false)
    });

    this.api.getTaggedManifest(rating).subscribe({
      next: (tagged) => this.taggedFiles.set(tagged)
    });
  }

  selectTrack(track: Track) {
    const rating = this.selectedRating();
    if (!rating) return;

    this.selectedTrack.set(track);
    this.isLoading.set(true);
    this.saveMessage.set(null);
    this.selectedArtFilename.set(null);
    this.isPlaying.set(false);
    this.currentTime.set(0);
    this.duration.set(0);

    this.api.getTrackMetadata(rating, track.filename).subscribe({
      next: (meta) => {
        this.metadata.set(meta);
        // Pre-fill: use existing tags if present, else suggested from filename
        this.artist.set(meta.current.artist || meta.suggested.artist);
        this.title.set(meta.current.title || meta.suggested.title);
        this.album.set(meta.current.album || meta.suggested.album);
        this.year.set(meta.current.year || meta.suggested.year);
        this.genre.set(meta.current.genre || '');
        this.trackNumber.set(meta.current.trackNumber || '');
        this.composer.set(meta.current.composer || '');
        this.publisher.set(meta.current.publisher || '');
        this.comment.set(meta.current.comment || '');
        this.radioStationUrl.set(meta.current.radioStationUrl || meta.suggested.radioStationUrl);
        this.embedArt.set(true);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false)
    });
  }

  useSuggested() {
    const meta = this.metadata();
    if (!meta) return;
    this.artist.set(meta.suggested.artist);
    this.title.set(meta.suggested.title);
    this.album.set(meta.suggested.album);
    this.year.set(meta.suggested.year);
  }

  pickArt(imageFilename: string) {
    this.selectedArtFilename.set(imageFilename);
  }

  clearArtOverride() {
    this.selectedArtFilename.set(null);
  }

  save() {
    const track = this.selectedTrack();
    const rating = this.selectedRating();
    if (!track || !rating || this.isSaving()) return;

    this.isSaving.set(true);
    this.saveMessage.set(null);

    this.api.saveTrackMetadata(rating, track.filename, {
      artist: this.artist(),
      title: this.title(),
      album: this.album(),
      year: this.year(),
      genre: this.genre(),
      trackNumber: this.trackNumber(),
      composer: this.composer(),
      publisher: this.publisher(),
      comment: this.comment(),
      radioStationUrl: this.radioStationUrl(),
      embedArt: this.embedArt(),
      artFilename: this.selectedArtFilename()
    }).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.saveMessage.set('Saved & tagged!');

        const tagged = [...this.taggedFiles()];
        if (!tagged.includes(track.filename)) {
          tagged.push(track.filename);
          this.taggedFiles.set(tagged);
        }

        setTimeout(() => {
          this.saveMessage.set(null);
          this.advanceToNextUntagged();
        }, 1200);
      },
      error: () => {
        this.isSaving.set(false);
        this.saveMessage.set('Error saving!');
      }
    });
  }

  advanceToNextUntagged() {
    const tagged = this.taggedFiles();
    const next = this.tracks().find(t => !tagged.includes(t.filename));
    if (next) {
      this.selectTrack(next);
    } else {
      this.selectedTrack.set(null);
      this.metadata.set(null);
    }
  }

  isTagged(filename: string): boolean {
    return this.taggedFiles().includes(filename);
  }

  goBack() {
    if (this.selectedTrack()) {
      this.selectedTrack.set(null);
      this.metadata.set(null);
    } else {
      this.selectedRating.set(null);
      this.tracks.set([]);
      this.taggedFiles.set([]);
      this.loadStats();
    }
  }

  getRatingCount(rating: string): number {
    const s = this.stats();
    if (!s) return 0;
    return (s as any)[rating] || 0;
  }
}
