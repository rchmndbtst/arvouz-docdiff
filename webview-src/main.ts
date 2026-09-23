import { renderAsync } from 'docx-preview';
import DOMPurify from 'dompurify';
import * as mammoth from 'mammoth';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';

type ViewMode = 'page' | 'reading';
type PaperTone = 'white' | 'sepia' | 'night';

interface ViewerSettings {
  defaultView: ViewMode;
  defaultZoom: number;
  defaultPaperTone: PaperTone;
}

interface ViewerState {
  mode: ViewMode;
  zoom: number;
  paperTone: PaperTone;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): ViewerState | undefined;
  setState(state: ViewerState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const PAPER_TONES: PaperTone[] = ['white', 'sepia', 'night'];
const ZOOM_STEP = 10;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`DocDiff webview is missing #${id}`);
  }
  return found as T;
}

const app = el('app');
const fileName = el('file-name');
const fileSize = el('file-size');
const loading = el('loading');
const loadingLabel = el('loading-label');
const errorState = el('error-state');
const errorMessage = el('error-message');
const zoomFrame = el('zoom-frame');
const zoomSurface = el('zoom-surface');
const visualContainer = el('visual-container');
const textContainer = el('text-container');
const modeVisualButton = el<HTMLButtonElement>('mode-visual');
const modeTextButton = el<HTMLButtonElement>('mode-text');
const zoomResetButton = el<HTMLButtonElement>('zoom-reset');
const themeButton = el<HTMLButtonElement>('paper-tone-button');
const paperToneLabel = el('paper-tone-label');

let state: ViewerState = { mode: 'page', zoom: 100, paperTone: 'white' };
let currentBuffer: ArrayBuffer | undefined;
let visualRendered = false;
let textRendered = false;

restoreState();
applyPaperTone(state.paperTone);
applyZoom(state.zoom);
updateModeButtons(state.mode);

modeVisualButton.addEventListener('click', () => void switchMode('page'));
modeTextButton.addEventListener('click', () => void switchMode('reading'));
el('zoom-in').addEventListener('click', () => applyZoom(state.zoom + ZOOM_STEP));
el('zoom-out').addEventListener('click', () => applyZoom(state.zoom - ZOOM_STEP));
zoomResetButton.addEventListener('click', () => applyZoom(100));
themeButton.addEventListener('click', () => applyPaperTone(nextPaperTone()));
el('retry-button').addEventListener('click', () => {
  showLoading('Reloading document...');
  vscode.postMessage({ type: 'retry' });
});

window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    applyZoom(state.zoom + ZOOM_STEP);
  } else if (event.key === '-') {
    event.preventDefault();
    applyZoom(state.zoom - ZOOM_STEP);
  } else if (event.key === '0') {
    event.preventDefault();
    applyZoom(100);
  }
});

window.addEventListener('message', (event: MessageEvent) => {
  handleMessage(event.data).catch((error: unknown) => {
    console.error('DocDiff could not process a host message:', error);
    showError('DocDiff could not render this document.');
  });
});

vscode.postMessage({ type: 'ready' });

async function handleMessage(message: Record<string, unknown>): Promise<void> {
  switch (message.type) {
    case 'document':
      await acceptDocument(message);
      break;
    case 'hostError':
      showError(typeof message.message === 'string' ? message.message : 'DocDiff could not reload the document.');
      break;
    case 'switchView':
      await switchMode(state.mode === 'page' ? 'reading' : 'page');
      break;
    case 'cyclePaperTone':
      applyPaperTone(nextPaperTone());
      break;
    case 'zoomIn':
      applyZoom(state.zoom + ZOOM_STEP);
      break;
    case 'zoomOut':
      applyZoom(state.zoom - ZOOM_STEP);
      break;
    case 'zoomReset':
      applyZoom(100);
      break;
    default:
      break;
  }
}

async function acceptDocument(message: Record<string, unknown>): Promise<void> {
  const settings = message.settings as ViewerSettings | undefined;
  const data = message.data as string | undefined;
  if (!data) {
    return;
  }
  if (!restoredFromState && settings) {
    state = { mode: settings.defaultView, zoom: settings.defaultZoom, paperTone: settings.defaultPaperTone };
  }
  restoredFromState = true;

  const bytes = decodeBase64(data);
  currentBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  visualRendered = false;
  textRendered = false;
  visualContainer.replaceChildren();
  textContainer.replaceChildren();
  fileName.textContent = typeof message.fileName === 'string' ? message.fileName : 'Word document';
  fileSize.textContent = typeof message.fileSize === 'number' ? formatSize(message.fileSize) : '';
  applyPaperTone(state.paperTone);
  applyZoom(state.zoom);
  updateModeButtons(state.mode);
  showLoading(message.reload ? 'Document changed. Rendering again...' : 'Rendering document...');
  await renderMode(state.mode);
}

let restoredFromState = false;

async function switchMode(mode: ViewMode): Promise<void> {
  state = { ...state, mode };
  persistState();
  updateModeButtons(mode);
  if (currentBuffer) {
    await renderMode(mode);
  }
}

async function renderMode(mode: ViewMode): Promise<void> {
  if (!currentBuffer) {
    return;
  }
  try {
    if (mode === 'page' && !visualRendered) {
      zoomFrame.classList.remove('hidden');
      visualContainer.classList.remove('hidden');
      textContainer.classList.add('hidden');
      await renderVisual(currentBuffer);
      visualRendered = true;
    }
    if (mode === 'reading' && !textRendered) {
      await renderText(currentBuffer);
      textRendered = true;
    }
    visualContainer.classList.toggle('hidden', mode !== 'page');
    textContainer.classList.toggle('hidden', mode !== 'reading');
    showContent();
  } catch (error: unknown) {
    console.error('DocDiff could not render the document:', error);
    showError(toRenderError(error));
  }
}

async function renderVisual(buffer: ArrayBuffer): Promise<void> {
  visualContainer.replaceChildren();
  let styleEl = document.getElementById('dd-docx-styles');
  if (!styleEl) {
    styleEl = document.createElement('div');
    styleEl.id = 'dd-docx-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.replaceChildren();
  await renderAsync(buffer, visualContainer, styleEl, {
    className: 'dd-visual',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: true,
    renderChanges: true,
    useBase64URL: true,
    trimXmlDeclaration: true,
    experimental: true,
  });
}

async function renderText(buffer: ArrayBuffer): Promise<void> {
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  textContainer.innerHTML = DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } });
}

function nextPaperTone(): PaperTone {
  const index = PAPER_TONES.indexOf(state.paperTone);
  return PAPER_TONES[(index + 1) % PAPER_TONES.length] as PaperTone;
}

function applyPaperTone(theme: PaperTone): void {
  state = { ...state, paperTone: theme };
  persistState();
  app.dataset.paperTone = theme;
  paperToneLabel.textContent = theme;
}

function applyZoom(value: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
  state = { ...state, zoom: clamped };
  persistState();
  zoomSurface.style.transform = `scale(${clamped / 100})`;
  zoomSurface.style.transformOrigin = 'top center';
  zoomResetButton.textContent = `${clamped}%`;
}

function updateModeButtons(mode: ViewMode): void {
  modeVisualButton.setAttribute('aria-pressed', String(mode === 'page'));
  modeTextButton.setAttribute('aria-pressed', String(mode === 'reading'));
}

function persistState(): void {
  vscode.setState(state);
}

function restoreState(): void {
  const saved = vscode.getState();
  if (saved) {
    state = saved;
    restoredFromState = true;
  }
}

function showLoading(label: string): void {
  loadingLabel.textContent = label;
  loading.classList.remove('hidden');
  errorState.classList.add('hidden');
  zoomFrame.classList.add('hidden');
}

function showContent(): void {
  loading.classList.add('hidden');
  errorState.classList.add('hidden');
  zoomFrame.classList.remove('hidden');
}

function showError(message: string): void {
  errorMessage.textContent = message;
  loading.classList.add('hidden');
  zoomFrame.classList.add('hidden');
  errorState.classList.remove('hidden');
}

function toRenderError(error: unknown): string {
  if (error instanceof Error && /zip|central directory|end of data|invalid/i.test(error.message)) {
    return 'This file appears to be corrupted or is not a valid Word document.';
  }
  return 'DocDiff could not render this document.';
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
