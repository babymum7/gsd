import { captureClip, type CaptureRegion } from "../injected/capture.ts";

export type { CaptureRegion } from "../injected/capture.ts";

export interface PageClient {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}


export async function capturePng(
  page: PageClient,
  region?: CaptureRegion,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const metrics = await page.request<{
    visualViewport?: {
      pageX?: number;
      pageY?: number;
      clientWidth?: number;
      clientHeight?: number;
    };
  }>("Page.getLayoutMetrics");
  const viewport = {
    pageX: metrics.visualViewport?.pageX ?? 0,
    pageY: metrics.visualViewport?.pageY ?? 0,
    clientWidth: metrics.visualViewport?.clientWidth ?? 0,
    clientHeight: metrics.visualViewport?.clientHeight ?? 0,
  };
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) {
    throw new Error("visible viewport is unavailable");
  }

  const params: Record<string, unknown> = { format: "png", fromSurface: true };
  let width = Math.round(viewport.clientWidth);
  let height = Math.round(viewport.clientHeight);
  if (region) {
    const clip = captureClip(region, viewport);
    params.clip = { ...clip, scale: 1 };
    width = clip.width;
    height = clip.height;
  }
  const result = await page.request<{ data: string }>("Page.captureScreenshot", params);
  return { dataUrl: `data:image/png;base64,${result.data}`, width, height };
}
