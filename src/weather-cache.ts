import type { WeatherSettings, WeatherSnapshot } from './types';

export const WEATHER_API_VERSION = 'open-meteo-v1';

export function weatherConfigKey(settings: WeatherSettings): string {
  const latitude = Number.parseFloat(String(settings.weatherLatitude));
  const longitude = Number.parseFloat(String(settings.weatherLongitude));
  return JSON.stringify({
    latitude: Number.isFinite(latitude) ? Number(latitude.toFixed(6)) : null,
    longitude: Number.isFinite(longitude) ? Number(longitude.toFixed(6)) : null,
    units: settings.weatherUnits === 'imperial' ? 'imperial' : 'metric',
    timezone: settings.weatherTimezone || 'auto',
    apiVersion: WEATHER_API_VERSION,
  });
}

export function migrateCompatibleSnapshot(
  snapshot: WeatherSnapshot | null | undefined,
  settings: WeatherSettings,
): WeatherSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const expected = weatherConfigKey(settings);
  if (snapshot.configKey === expected) return { ...snapshot };

  const latitude = Number.parseFloat(String(settings.weatherLatitude));
  const longitude = Number.parseFloat(String(settings.weatherLongitude));
  const snapshotLatitude = Number.parseFloat(String(snapshot.latitude));
  const snapshotLongitude = Number.parseFloat(String(snapshot.longitude));
  const sameLocation = Number.isFinite(snapshotLatitude) && Number.isFinite(snapshotLongitude)
    && Math.abs(snapshotLatitude - latitude) < 0.000001
    && Math.abs(snapshotLongitude - longitude) < 0.000001;
  const sameUnits = snapshot.units === (settings.weatherUnits === 'imperial' ? 'imperial' : 'metric');
  if (!sameLocation || !sameUnits) return null;

  return { ...snapshot, configKey: expected };
}

export function isSnapshotStale(
  snapshot: WeatherSnapshot | null | undefined,
  ttlHours: number,
  now = Date.now(),
): boolean {
  if (!snapshot) return true;
  const rawTimestamp = snapshot.cachedAt ?? snapshot.fetchedAt;
  if (!rawTimestamp) return true;
  const timestamp = new Date(rawTimestamp).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp > ttlHours * 60 * 60 * 1000;
}
