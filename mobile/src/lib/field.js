import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { fetch as expoFetch } from 'expo/fetch';
import api, { API_URL, tokens } from './api';

/**
 * The two things only a handset can do: say where it is, and send a photo.
 */

/**
 * GPS check-in at the visit address. The server works out the distance from
 * the case's target and QC sees it; the automatic check after submission
 * expects one within 2 km.
 */
export async function checkIn(investigationId) {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    const error = new Error('LOCATION_DENIED');
    error.code = 'LOCATION_DENIED';
    throw error;
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  const { data } = await api.post('/gps/events', {
    eventType: 'CHECK_IN',
    investigationId,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: position.coords.accuracy ?? undefined,
    altitudeM: position.coords.altitude ?? undefined,
    recordedAt: new Date(position.timestamp).toISOString(),
  });
  return data;
}

/** One location fix, for a GPS field on the form. */
export async function currentPoint() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('LOCATION_DENIED');
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: position.coords.accuracy ?? null,
  };
}

/**
 * Upload one picked photo as evidence on a case.
 *
 * Presigned first: with S3/R2/MinIO the bytes go straight to the bucket and
 * the API only confirms. A server on local-disk storage cannot sign URLs and
 * says so (`PRESIGN_UNSUPPORTED`); then the photo goes through the API as a
 * multipart upload. Either way the server checks the bytes are an image.
 */
export async function uploadPhoto({ asset, investigationId, categoryCode }) {
  const contentType = asset.mimeType || 'image/jpeg';
  const fileName = asset.fileName || `visit-${Date.now()}.jpg`;
  const part = await filePart(asset, fileName, contentType);
  const sizeBytes = asset.fileSize ?? part.size ?? 0;

  const meta = {
    mediaType: 'PHOTO',
    fileName,
    contentType,
    sizeBytes,
    investigationId,
    ...(categoryCode ? { categoryCode } : {}),
  };

  try {
    const { data: ticket } = await api.post('/media/request-upload', meta);
    const put = await expoFetch(ticket.uploadUrl, {
      method: ticket.method || 'PUT',
      headers: ticket.headers,
      body: part.body,
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    const { data } = await api.post(`/media/${ticket.assetId}/confirm`, {
      width: asset.width,
      height: asset.height,
    });
    return data;
  } catch (error) {
    if (error.details?.errorCode !== 'PRESIGN_UNSUPPORTED') throw error;
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(meta)) form.append(key, String(value));
  if (part.webBlob) form.append('file', part.webBlob, fileName);
  else form.append('file', part.body);

  const token = await tokens.access();
  const response = await expoFetch(`${API_URL}/media/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Upload failed');
    error.details = body;
    error.friendlyMessage = body?.message;
    throw error;
  }
  return body?.data ?? body;
}

/**
 * The file as something fetch can send. SDK 58 reads a local URI through
 * expo-file-system's `File`; the web preview has a blob: URL instead.
 */
async function filePart(asset, fileName, contentType) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    return { body: blob, webBlob: blob, size: blob.size };
  }
  const { File } = await import('expo-file-system');
  const file = new File(asset.uri);
  return { body: file, size: file.size, name: fileName, type: contentType };
}
