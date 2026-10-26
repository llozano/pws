import type { DeviceMatchResult, DeviceObservation } from './observation';

function isDeviceMatchResult(value: unknown): value is DeviceMatchResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.deviceClusterId === 'string' &&
    typeof result.confidence === 'number' &&
    typeof result.evidence === 'number' &&
    typeof result.matched === 'boolean'
  );
}

export async function registerDeviceObservation(
  observation: DeviceObservation,
): Promise<DeviceMatchResult> {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const response = await fetch(`${basePath}/api/device-observations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(observation),
    cache: 'no-store',
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Device matcher returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!isDeviceMatchResult(body)) {
    throw new Error('Device matcher returned an invalid response.');
  }
  return body;
}
