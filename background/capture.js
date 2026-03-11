/**
 * CVFilterX - Resume Screenshot Capture
 * Captures visible tab and crops to resume panel bounding rect
 */

async function captureResumeImage(_tabId, rect, dpr) {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

  const blob = await (await fetch(dataUrl)).blob();
  const imgBitmap = await createImageBitmap(blob);

  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(Math.round(rect.width * dpr), imgBitmap.width - sx);
  const sh = Math.min(Math.round(rect.height * dpr), imgBitmap.height - sy);

  if (sw <= 0 || sh <= 0) {
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgBitmap, -sx, -sy);

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await croppedBlob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
