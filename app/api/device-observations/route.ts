import { DeviceStoreCapacityError, deviceStore } from '@/server/deviceStore';
import { parseDeviceObservation } from '@/server/deviceObservationValidation';

export const runtime = 'nodejs';

const MAX_BODY_SIZE = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return Response.json({ error: 'Observation payload is too large.' }, { status: 413 });
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_SIZE) {
      return Response.json({ error: 'Observation payload is too large.' }, { status: 413 });
    }
    const body: unknown = JSON.parse(rawBody);
    const observation = parseDeviceObservation(body);
    const result = await deviceStore.register(observation);
    return Response.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (error instanceof DeviceStoreCapacityError) {
      console.error('Device observation store capacity exceeded.', error);
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof Error && /must|unsupported|too many/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    console.error('Failed to register device observation.', error);
    return Response.json({ error: 'Unable to register the device observation.' }, { status: 500 });
  }
}
