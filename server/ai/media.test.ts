import { describe, expect, it } from 'vitest';
import { audioMimeFromFile, extFor, MEDIA_FILE_RE, normalizeAudioMime, normalizeImageMime, serveType } from './media.js';

describe('normalizeAudioMime', () => {
  it('strips codec parameters and case', () => {
    expect(normalizeAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMime('Audio/OGG; codecs="opus"')).toBe('audio/ogg');
  });

  it('maps m4a, WhatsApp video/mp4 and mpeg aliases', () => {
    expect(normalizeAudioMime('audio/x-m4a')).toBe('audio/mp4');
    expect(normalizeAudioMime('audio/m4a')).toBe('audio/mp4');
    expect(normalizeAudioMime('video/mp4')).toBe('audio/mp4');
    expect(normalizeAudioMime('audio/mpeg')).toBe('audio/mp3');
    expect(normalizeAudioMime('audio/x-wav')).toBe('audio/wav');
  });

  it('accepts the supported types as they are', () => {
    for (const m of ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mp3', 'audio/aac', 'audio/flac']) expect(normalizeAudioMime(m)).toBe(m);
  });

  it('returns null for anything else', () => {
    for (const m of ['audio/x-unknown', 'video/webm', 'text/plain', 'application/json', '', undefined, null]) expect(normalizeAudioMime(m)).toBeNull();
  });
});

describe('images and files', () => {
  it('normalizes image types', () => {
    expect(normalizeImageMime('image/jpeg')).toBe('image/jpeg');
    expect(normalizeImageMime('image/jpg')).toBe('image/jpeg');
    expect(normalizeImageMime('image/png; charset=binary')).toBe('image/png');
    expect(normalizeImageMime('image/webp')).toBe('image/webp');
    expect(normalizeImageMime('image/gif')).toBeNull();
    expect(normalizeImageMime('image/svg+xml')).toBeNull();
  });

  it('names files by type and serves them with a safe type', () => {
    expect(extFor('audio/mp4')).toBe('m4a');
    expect(extFor('audio/webm')).toBe('webm');
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(serveType('m3.m4a')).toBe('audio/mp4');
    expect(serveType('m3.mp3')).toBe('audio/mpeg');
    expect(serveType('m3.jpg')).toBe('image/jpeg');
    expect(serveType('m3.html')).toBe('application/octet-stream');
  });

  it('takes the MIME type from a file extension', () => {
    expect(audioMimeFromFile('probe.webm')).toBe('audio/webm');
    expect(audioMimeFromFile('..\\spike\\audio\\hindi-order.m4a')).toBe('audio/mp4');
    expect(audioMimeFromFile('note.mp4')).toBe('audio/mp4');
    expect(audioMimeFromFile('photo.jpg')).toBeNull();
  });

  it('accepts only plain file names', () => {
    expect(MEDIA_FILE_RE.test('m12.webm')).toBe(true);
    for (const f of ['../x.png', '..\\x.png', 'a/b.png', 'm1.tts.wav', '.env', 'm1', 'm1.PNG']) expect(MEDIA_FILE_RE.test(f)).toBe(false);
  });
});
