import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Track {
  filename: string;
  size: number;
  addedAt: number;
}

export interface RateResponse {
  success: boolean;
  filename: string;
  rating: string;
  movedTo: string;
}

export interface Stats {
  inbox: number;
  Bad: number;
  OK: number;
  Good: number;
  'Real Good': number;
  Banger: number;
}

export interface TrackMetadata {
  current: {
    artist: string;
    title: string;
    album: string;
    year: string;
    genre: string;
    trackNumber: string;
    composer: string;
    publisher: string;
    comment: string;
    radioStationUrl: string;
    hasEmbeddedArt: boolean;
  };
  suggested: {
    artist: string;
    title: string;
    album: string;
    year: string;
    genre: string;
    trackNumber: string;
    composer: string;
    publisher: string;
    comment: string;
    radioStationUrl: string;
  };
  albumArt: string | null;
  defaultArt: string;
}

export interface MetadataSaveRequest {
  artist: string;
  title: string;
  album: string;
  year: string;
  genre: string;
  trackNumber: string;
  composer: string;
  publisher: string;
  comment: string;
  radioStationUrl: string;
  embedArt: boolean;
  artFilename: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = '/api';

  constructor(private http: HttpClient) {}

  getTracks(): Observable<Track[]> {
    return this.http.get<Track[]>(`${this.baseUrl}/tracks`);
  }

  getRatedTracks(rating: string): Observable<Track[]> {
    return this.http.get<Track[]>(`${this.baseUrl}/rated/${encodeURIComponent(rating)}/tracks`);
  }

  getStreamUrl(filename: string): string {
    return `${this.baseUrl}/tracks/${encodeURIComponent(filename)}/stream`;
  }

  getRatedStreamUrl(rating: string, filename: string): string {
    return `${this.baseUrl}/rated/${encodeURIComponent(rating)}/tracks/${encodeURIComponent(filename)}/stream`;
  }

  rateTrack(filename: string, rating: string): Observable<RateResponse> {
    return this.http.post<RateResponse>(
      `${this.baseUrl}/tracks/${encodeURIComponent(filename)}/rate`,
      { rating }
    );
  }

  reRateTrack(sourceRating: string, filename: string, newRating: string): Observable<RateResponse> {
    return this.http.post<RateResponse>(
      `${this.baseUrl}/rated/${encodeURIComponent(sourceRating)}/tracks/${encodeURIComponent(filename)}/rate`,
      { rating: newRating }
    );
  }

  getStats(): Observable<Stats> {
    return this.http.get<Stats>(`${this.baseUrl}/stats`);
  }

  getTrackMetadata(rating: string, filename: string): Observable<TrackMetadata> {
    return this.http.get<TrackMetadata>(
      `${this.baseUrl}/rated/${encodeURIComponent(rating)}/tracks/${encodeURIComponent(filename)}/metadata`
    );
  }

  saveTrackMetadata(rating: string, filename: string, data: MetadataSaveRequest): Observable<{ success: boolean; tagged: number }> {
    return this.http.post<{ success: boolean; tagged: number }>(
      `${this.baseUrl}/rated/${encodeURIComponent(rating)}/tracks/${encodeURIComponent(filename)}/metadata`,
      data
    );
  }

  getTaggedManifest(rating: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/rated/${encodeURIComponent(rating)}/tagged`);
  }

  getImages(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/images`);
  }

  getImageUrl(filename: string): string {
    return `${this.baseUrl}/images/${encodeURIComponent(filename)}`;
  }
}
