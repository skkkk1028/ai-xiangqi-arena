export type AnimationFrameHandle =
  | { kind: 'raf'; id: number }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

type AnimationFrameApi = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};

export function getAnimationFrameApi(): AnimationFrameApi | null {
  try {
    const request = globalThis.requestAnimationFrame;
    const cancel = globalThis.cancelAnimationFrame;
    if (typeof request !== 'function' || typeof cancel !== 'function') return null;
    return {
      request: request.bind(globalThis),
      cancel: cancel.bind(globalThis),
    };
  } catch {
    return null;
  }
}

export function getAnimationNow(): number {
  try {
    const now = globalThis.performance?.now;
    if (typeof now === 'function') return now.call(globalThis.performance);
  } catch {
    // Fall back below.
  }
  return Date.now();
}

export function requestAnimationFrameSafe(callback: FrameRequestCallback): AnimationFrameHandle {
  const api = getAnimationFrameApi();
  if (api) {
    return { kind: 'raf', id: api.request(callback) };
  }

  const id = setTimeout(() => {
    callback(getAnimationNow());
  }, 16);
  return { kind: 'timeout', id };
}

export function cancelAnimationFrameSafe(handle: AnimationFrameHandle | null | undefined): void {
  if (!handle) return;
  if (handle.kind === 'timeout') {
    clearTimeout(handle.id);
    return;
  }
  const api = getAnimationFrameApi();
  try {
    api?.cancel(handle.id);
  } catch {
    // Cancellation is best effort if the API disappears mid-frame.
  }
}

export function afterAnimationFrames(count = 1): Promise<void> {
  if (count <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = count;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrameSafe(step);
    };
    requestAnimationFrameSafe(step);
  });
}
