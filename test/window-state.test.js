const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  MIN_WIDTH,
  MIN_HEIGHT,
  isPositionVisible,
  resolveWindowState,
  trackWindowState
} = require('../lib/window-state');

test('resolveWindowState falls back to defaults when no state is provided', () => {
  const result = resolveWindowState();
  assert.equal(result.width, DEFAULT_WIDTH);
  assert.equal(result.height, DEFAULT_HEIGHT);
  assert.equal(result.x, undefined);
  assert.equal(result.y, undefined);
  assert.equal(result.isMaximized, false);
});

test('resolveWindowState enforces minimum width and height', () => {
  const result = resolveWindowState({ width: 500, height: 300 });
  assert.equal(result.width, MIN_WIDTH);
  assert.equal(result.height, MIN_HEIGHT);
});

test('resolveWindowState preserves maximized state flag', () => {
  const result = resolveWindowState({ isMaximized: true, width: 1600, height: 1000 });
  assert.equal(result.isMaximized, true);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 1000);
});

test('resolveWindowState checks position visibility against displays', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } }
  ];

  // Inside primary display
  const valid = resolveWindowState({ width: 1440, height: 960, x: 100, y: 50 }, displays);
  assert.equal(valid.x, 100);
  assert.equal(valid.y, 50);

  // Inside secondary display
  const secondary = resolveWindowState({ width: 1200, height: 800, x: 2000, y: 50 }, displays);
  assert.equal(secondary.x, 2000);
  assert.equal(secondary.y, 50);

  // Completely off-screen / disconnected display
  const offscreen = resolveWindowState({ width: 1200, height: 800, x: 6000, y: 5000 }, displays);
  assert.equal(offscreen.x, undefined);
  assert.equal(offscreen.y, undefined);
  assert.equal(offscreen.width, 1200);
  assert.equal(offscreen.height, 800);
});

test('resolveWindowState clamps width and height if display is smaller', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1366, height: 768 } }
  ];
  const result = resolveWindowState({ width: 2560, height: 1440 }, displays);
  assert.equal(result.width, 1366);
  assert.equal(result.height, 768);
});

function createMockWindow(initialBounds = { width: 1440, height: 960, x: 50, y: 50 }, maximized = false) {
  const emitter = new EventEmitter();
  let bounds = { ...initialBounds };
  let isMax = maximized;
  let isMin = false;
  let isDestroyed = false;

  emitter.getBounds = () => ({ ...bounds });
  emitter.setBounds = b => { bounds = { ...bounds, ...b }; };
  emitter.isMaximized = () => isMax;
  emitter.setMaximized = v => { isMax = v; };
  emitter.isMinimized = () => isMin;
  emitter.setMinimized = v => { isMin = v; };
  emitter.isFullScreen = () => false;
  emitter.isDestroyed = () => isDestroyed;
  emitter.destroy = () => { isDestroyed = true; };

  return emitter;
}

test('trackWindowState captures resize and move with debounce', async () => {
  const win = createMockWindow({ width: 1440, height: 960, x: 10, y: 20 });
  const saves = [];
  const tracker = trackWindowState(win, state => saves.push(state), { debounceMs: 20 });

  win.setBounds({ width: 1500, height: 980 });
  win.emit('resize');

  win.setBounds({ x: 30, y: 40 });
  win.emit('move');

  // Before debounce completes
  assert.equal(saves.length, 0);

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(saves.length, 1);
  assert.equal(saves[0].width, 1500);
  assert.equal(saves[0].height, 980);
  assert.equal(saves[0].x, 30);
  assert.equal(saves[0].y, 40);
  assert.equal(saves[0].isMaximized, false);

  tracker.destroy();
});

test('trackWindowState handles maximize and unmaximize while retaining unmaximized bounds', async () => {
  const win = createMockWindow({ width: 1440, height: 960, x: 50, y: 50 });
  const saves = [];
  const tracker = trackWindowState(win, state => saves.push(state), { debounceMs: 20 });

  // User maximizes window: OS changes bounds to screen, emits maximize
  win.setMaximized(true);
  win.setBounds({ width: 1920, height: 1080, x: 0, y: 0 });
  win.emit('maximize');

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(saves.length, 1);
  assert.equal(saves[0].isMaximized, true);
  // Preserved the unmaximized normal bounds
  assert.equal(saves[0].width, 1440);
  assert.equal(saves[0].height, 960);
  assert.equal(saves[0].x, 50);
  assert.equal(saves[0].y, 50);

  // User unmaximizes: OS restores normal bounds
  win.setMaximized(false);
  win.setBounds({ width: 1440, height: 960, x: 50, y: 50 });
  win.emit('unmaximize');

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(saves.length, 2);
  assert.equal(saves[1].isMaximized, false);
  assert.equal(saves[1].width, 1440);
  assert.equal(saves[1].height, 960);

  tracker.destroy();
});

test('trackWindowState calls synchronous save immediately on close', () => {
  const win = createMockWindow({ width: 1300, height: 850, x: 100, y: 100 }, true);
  const syncSaves = [];
  const normalSaves = [];
  const tracker = trackWindowState(win, state => normalSaves.push(state), {
    debounceMs: 500,
    onSyncSave: state => syncSaves.push(state),
    initialState: { width: 1300, height: 850, x: 100, y: 100, isMaximized: true }
  });

  win.emit('close');

  assert.equal(syncSaves.length, 1);
  assert.equal(syncSaves[0].isMaximized, true);
  assert.equal(syncSaves[0].width, 1300);
  assert.equal(syncSaves[0].height, 850);
  assert.equal(normalSaves.length, 0);

  tracker.destroy();
});
