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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = '/api';

  constructor(private http: HttpClient) {}

  getTracks(): Observable<Track[]> {
    return this.http.get<Track[]>(`${this.baseUrl}/tracks`);
  }

  getStreamUrl(filename: string): string {
    return `${this.baseUrl}/tracks/${encodeURIComponent(filename)}/stream`;
  }

  rateTrack(filename: string, rating: string): Observable<RateResponse> {
    return this.http.post<RateResponse>(
      `${this.baseUrl}/tracks/${encodeURIComponent(filename)}/rate`,
      { rating }
    );
  }

  getStats(): Observable<Stats> {
    return this.http.get<Stats>(`${this.baseUrl}/stats`);
  }
}
