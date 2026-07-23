export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualViewport {
  pageX: number;
  pageY: number;
  clientWidth: number;
  clientHeight: number;
}

export function captureClip(region: CaptureRegion, viewport: VisualViewport): CaptureRegion {
  const values = [
    region.x,
    region.y,
    region.width,
    region.height,
    viewport.pageX,
    viewport.pageY,
    viewport.clientWidth,
    viewport.clientHeight,
  ];
  if (!values.every(Number.isFinite)) throw new Error("capture geometry must contain finite numbers");
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) throw new Error("visible viewport is unavailable");
  if (region.width <= 0 || region.height <= 0) throw new Error("capture region is too small");
  if (region.x < 0 || region.y < 0) throw new Error("capture region cannot start outside the viewport");

  const left = Math.round(region.x);
  const top = Math.round(region.y);
  const requestedWidth = Math.round(region.width);
  const requestedHeight = Math.round(region.height);
  const right = Math.min(Math.round(viewport.clientWidth), left + requestedWidth);
  const bottom = Math.min(Math.round(viewport.clientHeight), top + requestedHeight);
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) throw new Error("capture region is too small");

  return {
    x: Math.round(viewport.pageX + left),
    y: Math.round(viewport.pageY + top),
    width,
    height,
  };
}
