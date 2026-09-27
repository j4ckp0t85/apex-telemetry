// Window state persistence and bounds management for Electron BrowserWindow

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 960;
const MIN_WIDTH = 1060;
const MIN_HEIGHT = 720;

/**
 * Checks whether a rectangle has a visible intersection with any connected display.
 * Requires at least 100px width and 40px height to ensure user can see and grab the window.
 */
function isPositionVisible(x, y, width, height, displays) {
  if (!Array.isArray(displays) || displays.length === 0) return true;
  return displays.some(display => {
    const area = display.workArea || display.bounds;
    if (!area) return false;
    const overlapX = Math.max(0, Math.min(x + width, area.x + area.width) - Math.max(x, area.x));
    const overlapY = Math.max(0, Math.min(y + height, area.y + area.height) - Math.max(y, area.y));
    return overlapX >= 100 && overlapY >= 40;
  });
}

/**
 * Resolves and validates window state from saved settings against current displays.
 */
function resolveWindowState(saved = {}, displays = []) {
  const isMaximized = Boolean(saved && saved.isMaximized);

  let width = Number.isFinite(saved?.width) ? Math.round(saved.width) : DEFAULT_WIDTH;
  let height = Number.isFinite(saved?.height) ? Math.round(saved.height) : DEFAULT_HEIGHT;

  if (width < MIN_WIDTH) width = MIN_WIDTH;
  if (height < MIN_HEIGHT) height = MIN_HEIGHT;

  if (Array.isArray(displays) && displays.length > 0) {
    const maxAreaWidth = displays.reduce((max, d) => Math.max(max, d.workArea?.width || d.bounds?.width || 0), 0);
    const maxAreaHeight = displays.reduce((max, d) => Math.max(max, d.workArea?.height || d.bounds?.height || 0), 0);
    if (maxAreaWidth >= MIN_WIDTH && width > maxAreaWidth) width = maxAreaWidth;
    if (maxAreaHeight >= MIN_HEIGHT && height > maxAreaHeight) height = maxAreaHeight;
  }

  let x = Number.isFinite(saved?.x) ? Math.round(saved.x) : undefined;
  let y = Number.isFinite(saved?.y) ? Math.round(saved.y) : undefined;

  if (x !== undefined && y !== undefined) {
    if (!isPositionVisible(x, y, width, height, displays)) {
      x = undefined;
      y = undefined;
    }
  } else {
    x = undefined;
    y = undefined;
  }

  return {
    width,
    height,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    isMaximized
  };
}

/**
 * Observes window resize, move, maximize, and unmaximize events.
 * Debounces persistence during interactions and flushes synchronously on close.
 */
function trackWindowState(win, onSave, options = {}) {
  const debounceMs = options.debounceMs ?? 250;
  let saveTimer = null;
  let isMaximizedState = Boolean(options.initialState?.isMaximized ?? (typeof win.isMaximized === 'function' ? win.isMaximized() : false));

  let lastNormalBounds = {
    width: options.initialState?.width || DEFAULT_WIDTH,
    height: options.initialState?.height || DEFAULT_HEIGHT,
    x: options.initialState?.x,
    y: options.initialState?.y
  };

  function isDestroyed() {
    return typeof win.isDestroyed === 'function' && win.isDestroyed();
  }

  function isMinimized() {
    return !isDestroyed() && typeof win.isMinimized === 'function' && win.isMinimized();
  }

  function isMaximized() {
    if (isMinimized()) return isMaximizedState;
    if (isDestroyed()) return isMaximizedState;
    return typeof win.isMaximized === 'function' ? win.isMaximized() : isMaximizedState;
  }

  function isFullScreen() {
    return !isDestroyed() && typeof win.isFullScreen === 'function' && win.isFullScreen();
  }

  function updateNormalBounds() {
    if (isDestroyed() || isMinimized() || isMaximized() || isFullScreen()) return;
    if (typeof win.getBounds !== 'function') return;
    try {
      const b = win.getBounds();
      if (b && typeof b.width === 'number' && typeof b.height === 'number') {
        lastNormalBounds = {
          width: Math.max(MIN_WIDTH, Math.round(b.width)),
          height: Math.max(MIN_HEIGHT, Math.round(b.height)),
          x: Number.isFinite(b.x) ? Math.round(b.x) : lastNormalBounds.x,
          y: Number.isFinite(b.y) ? Math.round(b.y) : lastNormalBounds.y
        };
      }
    } catch (_) {}
  }

  updateNormalBounds();

  function getState() {
    updateNormalBounds();
    return {
      width: lastNormalBounds.width,
      height: lastNormalBounds.height,
      ...(typeof lastNormalBounds.x === 'number' ? { x: lastNormalBounds.x } : {}),
      ...(typeof lastNormalBounds.y === 'number' ? { y: lastNormalBounds.y } : {}),
      isMaximized: isMaximized()
    };
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const state = getState();
    if (typeof onSave === 'function') {
      try { onSave(state); } catch (_) {}
    }
    return state;
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, debounceMs);
  }

  function onResizeOrMove() {
    updateNormalBounds();
    scheduleSave();
  }

  function onMaximize() {
    isMaximizedState = true;
    scheduleSave();
  }

  function onUnmaximize() {
    isMaximizedState = false;
    updateNormalBounds();
    scheduleSave();
  }

  function onClose() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const state = getState();
    if (typeof options.onSyncSave === 'function') {
      try { options.onSyncSave(state); } catch (_) {}
    } else if (typeof onSave === 'function') {
      try { onSave(state); } catch (_) {}
    }
  }

  win.on('resize', onResizeOrMove);
  win.on('move', onResizeOrMove);
  win.on('maximize', onMaximize);
  win.on('unmaximize', onUnmaximize);
  win.on('close', onClose);

  return {
    flush,
    getState,
    destroy() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (typeof win.removeListener === 'function') {
        win.removeListener('resize', onResizeOrMove);
        win.removeListener('move', onResizeOrMove);
        win.removeListener('maximize', onMaximize);
        win.removeListener('unmaximize', onUnmaximize);
        win.removeListener('close', onClose);
      }
    }
  };
}

module.exports = {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  MIN_WIDTH,
  MIN_HEIGHT,
  isPositionVisible,
  resolveWindowState,
  trackWindowState
};
