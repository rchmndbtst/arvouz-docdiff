import { renderAsync } from 'docx-preview';
import DOMPurify from 'dompurify';
import * as mammoth from 'mammoth';
import './styles.css';

type RenderMode = 'visual' | 'text';
type PageTheme = 'paper' | 'sepia' | 'dark';

interface ViewerSettings {
  defaultMode: RenderMode;
  defaultZoom: number;
  defaultPageTheme: PageTheme;
}

interface ViewerState {
  mode: RenderMode;
  zoom: number;
  pageTheme: PageTheme;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): ViewerState | undefined;
  setState(state: ViewerState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const PAGE_THEMES: PageTheme[] = ['paper', 'sepia', 'dark'];
const ZOOM_STEP = 10;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`GitDoc webview is missing #${id}`);
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
const themeButton = el<HTMLButtonElement>('page-theme-button');

let state: ViewerState = { mode: 'visual', zoom: 100, pageTheme: 'paper' };
let currentBuffer: ArrayBuffer | undefined;
let visualRendered = false;
let textRendered = false;

restoreState();
applyPageTheme(state.pageTheme);
applyZoom(state.zoom);
updateModeButtons(state.mode);

modeVisualButton.addEventListener('click', () => void switchMode('visual'));
modeTextButton.addEventListener('click', () => void switchMode('text'));
el('zoom-in').addEventListener('click', () => applyZoom(state.zoom + ZOOM_STEP));
el('zoom-out').addEventListener('click', () => applyZoom(state.zoom - ZOOM_STEP));
zoomResetButton.addEventListener('click', () => applyZoom(100));
themeButton.addEventListener('click', () => applyPageTheme(nextPageTheme()));
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
    console.error('GitDoc could not process a host message:', error);
    showError('GitDoc could not render this document.');
  });
});

vscode.postMessage({ type: 'ready' });

async function handleMessage(message: Record<string, unknown>): Promise<void> {
  switch (message.type) {
    case 'document':
      await acceptDocument(message);
      break;
    case 'hostError':
      showError(typeof message.message === 'string' ? message.message : 'GitDoc could not reload the document.');
      break;
    case 'toggleMode':
      await switchMode(state.mode === 'visual' ? 'text' : 'visual');
      break;
    case 'cyclePageTheme':
      applyPageTheme(nextPageTheme());
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
    state = { mode: settings.defaultMode, zoom: settings.defaultZoom, pageTheme: settings.defaultPageTheme };
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
  applyPageTheme(state.pageTheme);
  applyZoom(state.zoom);
  updateModeButtons(state.mode);
  showLoading(message.reload ? 'Document changed. Rendering again...' : 'Rendering document...');
  await renderMode(state.mode);
}

let restoredFromState = false;

async function switchMode(mode: RenderMode): Promise<void> {
  state = { ...state, mode };
  persistState();
  updateModeButtons(mode);
  if (currentBuffer) {
    await renderMode(mode);
  }
}

async function renderMode(mode: RenderMode): Promise<void> {
  if (!currentBuffer) {
    return;
  }
  try {
    if (mode === 'visual' && !visualRendered) {
      zoomFrame.classList.remove('hidden');
      visualContainer.classList.remove('hidden');
      textContainer.classList.add('hidden');
      await renderVisual(currentBuffer);
      visualRendered = true;
    }
    if (mode === 'text' && !textRendered) {
      await renderText(currentBuffer);
      textRendered = true;
    }
    visualContainer.classList.toggle('hidden', mode !== 'visual');
    textContainer.classList.toggle('hidden', mode !== 'text');
    showContent();
  } catch (error: unknown) {
    console.error('GitDoc could not render the document:', error);
    showError(toRenderError(error));
  }
}

async function renderVisual(buffer: ArrayBuffer): Promise<void> {
  visualContainer.replaceChildren();
  let styleEl = document.getElementById('gitdoc-docx-styles');
  if (!styleEl) {
    styleEl = document.createElement('div');
    styleEl.id = 'gitdoc-docx-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.replaceChildren();
  await renderAsync(buffer, visualContainer, styleEl, {
    className: 'gitdoc-visual',
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

function nextPageTheme(): PageTheme {
  const index = PAGE_THEMES.indexOf(state.pageTheme);
  return PAGE_THEMES[(index + 1) % PAGE_THEMES.length] as PageTheme;
}

function applyPageTheme(theme: PageTheme): void {
  state = { ...state, pageTheme: theme };
  persistState();
  app.dataset.pageTheme = theme;
  themeButton.textContent = `Theme: ${theme}`;
}

function applyZoom(value: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
  state = { ...state, zoom: clamped };
  persistState();
  zoomSurface.style.transform = `scale(${clamped / 100})`;
  zoomSurface.style.transformOrigin = 'top center';
  zoomResetButton.textContent = `${clamped}%`;
}

function updateModeButtons(mode: RenderMode): void {
  modeVisualButton.setAttribute('aria-pressed', String(mode === 'visual'));
  modeTextButton.setAttribute('aria-pressed', String(mode === 'text'));
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
  return 'GitDoc could not render this document.';
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
