// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gameApiBaseUrl, gameWsBaseUrl } from './endpoints';

const ORIGINAL_LOCATION = window.location;

function setLocation(href: string): void {
  // jsdom's location is read-only; replace the whole property to override.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL(href),
  });
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  vi.unstubAllEnvs();
});

describe('gameApiBaseUrl', () => {
  it('returns NEXT_PUBLIC_GAME_API_URL verbatim when set', () => {
    vi.stubEnv('NEXT_PUBLIC_GAME_API_URL', 'https://api.example.com');
    setLocation('http://localhost:3000');
    expect(gameApiBaseUrl()).toBe('https://api.example.com');
  });

  it('drops the port suffix on HTTPS pages so requests route through nginx', () => {
    setLocation('https://skipbo.johnmoorman.com/rooms/abc');
    expect(gameApiBaseUrl()).toBe('https://skipbo.johnmoorman.com');
  });

  it('uses :8787 on HTTP pages for LAN/local development', () => {
    setLocation('http://192.168.0.29:3000/rooms/abc');
    expect(gameApiBaseUrl()).toBe('http://192.168.0.29:8787');
  });
});

describe('gameWsBaseUrl', () => {
  it('returns NEXT_PUBLIC_GAME_WS_URL verbatim when set', () => {
    vi.stubEnv('NEXT_PUBLIC_GAME_WS_URL', 'wss://ws.example.com');
    setLocation('http://localhost:3000');
    expect(gameWsBaseUrl()).toBe('wss://ws.example.com');
  });

  it('drops the port suffix on HTTPS pages (nginx fronts the WSS upgrade)', () => {
    setLocation('https://skipbo.johnmoorman.com/rooms/abc');
    expect(gameWsBaseUrl()).toBe('wss://skipbo.johnmoorman.com');
  });

  it('uses ws:// with :8787 on HTTP pages for LAN/local development', () => {
    setLocation('http://192.168.0.29:3000/rooms/abc');
    expect(gameWsBaseUrl()).toBe('ws://192.168.0.29:8787');
  });
});
