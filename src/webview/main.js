const vscode = acquireVsCodeApi();

const FONT_MIN = 10;
const FONT_MAX = 18;

function clampFontSize(n) {
  const v = Number(n) || 12;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(v)));
}

const previousState = vscode.getState();
let state = previousState
  ? {
      ...previousState,
      endpoints: previousState.endpoints || [],
      id1: previousState.id1 || '',
      id2: previousState.id2 || '',
      root1: previousState.root1 || '',
      root2: previousState.root2 || '',
      ref1: previousState.ref1 || previousState.baseBranch || '',
      ref2: previousState.ref2 || previousState.targetBranch || '',
      label1: previousState.label1 || '',
      label2: previousState.label2 || '',
      expandedFolders: new Set(previousState.expandedFolders || []),
      collapsedGroups: new Set(previousState.collapsedGroups || []),
      pathCaseInsensitive:
        typeof previousState.pathCaseInsensitive === 'boolean'
          ? previousState.pathCaseInsensitive
          : true,
    }
  : {
      endpoints: [],
      id1: '',
      id2: '',
      root1: '',
      root2: '',
      ref1: '',
      ref2: '',
      label1: '',
      label2: '',
      diffFiles: [],
      commits: [],
      expandedFolders: new Set(),
      collapsedGroups: new Set(),
      totalStats: { additions: 0, deletions: 0 },
      selectedPath: '',
      listFontSize: 12,
      pathCaseInsensitive: true,
    };

if (previousState) {
  state.selectedPath = previousState.selectedPath || '';
  state.listFontSize = clampFontSize(previousState.listFontSize || 12);
  state.collapsedGroups = new Set(previousState.collapsedGroups || []);
  state.endpoints = previousState.endpoints || [];
}

function saveState() {
  vscode.setState({
    ...state,
    expandedFolders: Array.from(state.expandedFolders || []),
    collapsedGroups: Array.from(state.collapsedGroups || []),
  });
}

const endpoint1 = document.getElementById('endpoint1');
const endpoint2 = document.getElementById('endpoint2');
const swapBtn = document.getElementById('swapBtn');
const refreshBtn = document.getElementById('refreshBtn');
const fileTree = document.getElementById('fileTree');
const commitList = document.getElementById('commitList');
const commitSearch = document.getElementById('commitSearch');
const changesCount = document.getElementById('changesCount');
const compareContext = document.getElementById('compareContext');
const totalAdditions = document.getElementById('totalAdditions');
const totalDeletions = document.getElementById('totalDeletions');
const commitsTitle = document.getElementById('commitsTitle');
const fontMinus = document.getElementById('fontMinus');
const fontPlus = document.getElementById('fontPlus');
const fontSizeLabel = document.getElementById('fontSizeLabel');

function targetsPayload(extra) {
  return {
    root1: state.root1,
    root2: state.root2,
    ref1: state.ref1,
    ref2: state.ref2,
    ...extra,
  };
}

function normalizeRoot(p) {
  if (!p) {
    return '';
  }
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '');
}

function rootKey(p) {
  const n = normalizeRoot(p);
  return state.pathCaseInsensitive ? n.toLowerCase() : n;
}

function sameRepo() {
  if (!state.root1 || !state.root2) {
    return false;
  }
  return rootKey(state.root1) === rootKey(state.root2);
}

function statusForPath(filePath) {
  const hit = (state.diffFiles || []).find((f) => f.path === filePath);
  return hit ? hit.status : '';
}

function findEndpoint(id) {
  return (state.endpoints || []).find((e) => e.id === id);
}

function applyEndpointId(side, id) {
  const ep = findEndpoint(id);
  if (!ep) {
    return false;
  }
  if (side === 1) {
    state.id1 = ep.id;
    state.root1 = ep.root;
    state.ref1 = ep.ref;
    state.label1 = ep.label;
  } else {
    state.id2 = ep.id;
    state.root2 = ep.root;
    state.ref2 = ep.ref;
    state.label2 = ep.label;
  }
  return true;
}

function ensureCommitsCollapsed() {
  const header = document.getElementById('commitsHeader');
  const body = document.getElementById('commitsBody');
  const section = header && header.closest('section');
  if (!header || !body || !section) {
    return;
  }
  header.classList.add('collapsed');
  body.classList.add('collapsed');
  section.classList.add('collapsed');
}

function init() {
  endpoint1.addEventListener('change', () => onEndpointChange(1));
  endpoint2.addEventListener('change', () => onEndpointChange(2));
  swapBtn.addEventListener('click', onSwapSides);
  refreshBtn.addEventListener('click', onRefresh);
  commitSearch.addEventListener('input', onCommitSearch);
  if (fontMinus) {
    fontMinus.addEventListener('click', (e) => {
      e.stopPropagation();
      bumpListFont(-1);
    });
  }
  if (fontPlus) {
    fontPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      bumpListFont(1);
    });
  }
  const fontTools = document.getElementById('fontSizeTools');
  if (fontTools) {
    fontTools.addEventListener('click', (e) => e.stopPropagation());
  }
  applyListFontSize();

  ensureCommitsCollapsed();

  document.getElementById('changesHeader').addEventListener('click', () => {
    toggleSection('changesHeader', 'changesBody');
  });
  document.getElementById('commitsHeader').addEventListener('click', () => {
    toggleSection('commitsHeader', 'commitsBody');
  });

  fileTree.addEventListener('click', (e) => {
    const groupHdr = e.target.closest('.scm-group');
    if (groupHdr && groupHdr.dataset.status) {
      e.stopPropagation();
      toggleGroupCollapsed(groupHdr.dataset.status);
      return;
    }

    const discardBtn = e.target.closest('.scm-action-discard');
    if (discardBtn) {
      e.stopPropagation();
      const row = discardBtn.closest('.scm-resource');
      if (!row) {
        return;
      }
      selectPath(row.dataset.path, false);
      vscode.postMessage(
        targetsPayload({
          command: 'discardFile',
          filePath: row.dataset.path,
          status: row.dataset.status || '',
        })
      );
      return;
    }

    const openBtn = e.target.closest('.scm-action-open');
    if (openBtn) {
      e.stopPropagation();
      const row = openBtn.closest('.scm-resource');
      if (!row) {
        return;
      }
      selectPath(row.dataset.path, false);
      vscode.postMessage({
        command: 'openFile',
        root: state.root2,
        filePath: row.dataset.path,
      });
      return;
    }

    const row = e.target.closest('.scm-resource');
    if (row && row.dataset.path) {
      selectPath(row.dataset.path, true);
    }
  });

  fileTree.addEventListener('keydown', onFileTreeKeydown);

  initResizer();

  if (state.root1 && state.root2) {
    fileTree.innerHTML = '<div class="loading">Restoring last compare…</div>';
  }
  vscode.postMessage(targetsPayload({ command: 'getEndpoints' }));

  if (previousState && previousState.diffFiles && previousState.diffFiles.length > 0) {
    renderFileTree(state.diffFiles, state.totalStats || { additions: 0, deletions: 0 }, true);
  }
  if (previousState && previousState.commits && previousState.commits.length > 0) {
    renderCommits(state.commits);
  }
  ensureCommitsCollapsed();
}

function initResizer() {
  const resizer = document.getElementById('resizer');
  const changesSection = document.querySelector('.changes-section');
  const commitsSection = document.querySelector('.commits-section');
  const content = document.querySelector('.content');

  let isResizing = false;
  let startY = 0;
  let startChangesHeight = 0;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startChangesHeight = changesSection.offsetHeight;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) {
      return;
    }
    const deltaY = e.clientY - startY;
    const contentHeight = content.offsetHeight;
    const newChangesHeight = Math.max(60, Math.min(contentHeight - 100, startChangesHeight + deltaY));
    changesSection.style.flex = 'none';
    changesSection.style.height = newChangesHeight + 'px';
    commitsSection.style.flex = '1';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function toggleSection(headerId, bodyId) {
  const header = document.getElementById(headerId);
  const body = document.getElementById(bodyId);
  const section = header.closest('section');
  header.classList.toggle('collapsed');
  body.classList.toggle('collapsed');
  section.classList.toggle('collapsed');
}

/**
 * Fill one endpoint select. Peer id is excluded so sides stay unique.
 * Returns the selected id.
 */
function fillEndpointSelect(select, selectedId, excludeId) {
  select.innerHTML = '';
  const list = (state.endpoints || []).filter((e) => e.id !== excludeId);
  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = excludeId ? 'No other endpoint' : 'No endpoints';
    select.appendChild(opt);
    return '';
  }

  let matched = '';
  list.forEach((ep) => {
    const opt = document.createElement('option');
    opt.value = ep.id;
    opt.textContent = ep.label;
    opt.title = `${ep.root}  @  ${ep.ref}`;
    if (selectedId && ep.id === selectedId) {
      opt.selected = true;
      matched = ep.id;
    }
    select.appendChild(opt);
  });

  if (!matched) {
    matched = list[0].id;
    select.value = matched;
  } else {
    select.value = matched;
  }
  select.title = (findEndpoint(matched) || {}).label || matched;
  return matched;
}

function syncSelectsFromState() {
  // Side 1: all endpoints; side 2: all except id1
  const id1 = fillEndpointSelect(endpoint1, state.id1, '');
  applyEndpointId(1, id1);
  let id2 = fillEndpointSelect(endpoint2, state.id2, state.id1);
  if (id2 === state.id1) {
    id2 = fillEndpointSelect(endpoint2, '', state.id1);
  }
  applyEndpointId(2, id2);
  updateSideTitles();
  saveState();
}

function onEndpointChange(side) {
  if (side === 1) {
    applyEndpointId(1, endpoint1.value);
    // Rebuild side 2 without the new peer; keep prior id2 if still valid.
    const id2 = fillEndpointSelect(endpoint2, state.id2, state.id1);
    applyEndpointId(2, id2);
  } else {
    applyEndpointId(2, endpoint2.value);
    if (state.id2 === state.id1) {
      // Should not happen (excluded), but force uniqueness.
      const id2 = fillEndpointSelect(endpoint2, '', state.id1);
      applyEndpointId(2, id2);
    }
  }
  updateSideTitles();
  saveState();
  if (state.root1 && state.root2 && state.ref1 && state.ref2 && state.id1 !== state.id2) {
    loadDiff();
  }
}

function onSwapSides() {
  const tmp = {
    id: state.id1,
    root: state.root1,
    ref: state.ref1,
    label: state.label1,
  };
  state.id1 = state.id2;
  state.root1 = state.root2;
  state.ref1 = state.ref2;
  state.label1 = state.label2;
  state.id2 = tmp.id;
  state.root2 = tmp.root;
  state.ref2 = tmp.ref;
  state.label2 = tmp.label;

  syncSelectsFromState();
  if (state.root1 && state.root2 && state.ref1 && state.ref2) {
    loadDiff();
  }
}

let loadDiffTimer = null;

function loadDiff() {
  if (!state.root1 || !state.root2 || !state.ref1 || !state.ref2) {
    return;
  }
  if (state.id1 && state.id2 && state.id1 === state.id2) {
    fileTree.innerHTML = '<div class="empty-state">Pick two different endpoints</div>';
    return;
  }
  const key = `${state.root1}\0${state.ref1}\0${state.root2}\0${state.ref2}`;
  if (loadDiffTimer) {
    clearTimeout(loadDiffTimer);
  }
  loadDiffTimer = setTimeout(() => {
    loadDiffTimer = null;
    runLoadDiff(key);
  }, 40);
}

function runLoadDiff(key) {
  if (!state.root1 || !state.root2 || !state.ref1 || !state.ref2) {
    return;
  }
  const nowKey = `${state.root1}\0${state.ref1}\0${state.root2}\0${state.ref2}`;
  if (nowKey !== key) {
    return;
  }
  fileTree.innerHTML = '<div class="loading">Loading changes...</div>';
  ensureCommitsCollapsed();
  updateCommitsTitle();

  vscode.postMessage(targetsPayload({ command: 'getDiff' }));
  if (sameRepo()) {
    commitList.innerHTML = '<div class="loading">Loading commits...</div>';
    vscode.postMessage(targetsPayload({ command: 'getCommitHistory' }));
  } else {
    state.commits = [];
    commitList.innerHTML =
      '<div class="empty-state">Commit history needs the same repository on both targets</div>';
  }
}

function onRefresh() {
  fileTree.innerHTML = '<div class="loading">Refreshing...</div>';
  vscode.postMessage(targetsPayload({ command: 'refresh' }));
}

function updateCommitsTitle() {
  if (sameRepo()) {
    commitsTitle.textContent = 'COMMIT HISTORY';
  } else {
    commitsTitle.textContent = 'COMMIT HISTORY (same repo only)';
  }
}

function updateSideTitles() {
  const side1 = document.querySelector('.side-1');
  const side2 = document.querySelector('.side-2');
  if (side1) {
    side1.title = state.label1 || `${state.root1} @ ${state.ref1}`;
  }
  if (side2) {
    side2.title = state.label2 || `${state.root2} @ ${state.ref2}`;
  }
  updateCompareContext();
}

function updateCompareContext() {
  if (!compareContext) {
    return;
  }
  if (state.label1 && state.label2) {
    compareContext.textContent = `${state.label1} → ${state.label2}`;
    compareContext.title = compareContext.textContent;
  } else if (state.root1 && state.ref1 && state.root2 && state.ref2) {
    compareContext.textContent = `${state.ref1} → ${state.ref2}`;
    compareContext.title = compareContext.textContent;
  } else {
    compareContext.textContent = '';
    compareContext.title = '';
  }
}

function selectPath(filePath, openDiff) {
  state.selectedPath = filePath || '';
  saveState();
  fileTree.querySelectorAll('.scm-resource.selected').forEach((el) => {
    el.classList.remove('selected');
  });
  if (!filePath) {
    return;
  }
  const row = fileTree.querySelector(`.scm-resource[data-path="${cssEscape(filePath)}"]`);
  if (row) {
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest' });
  }
  if (openDiff) {
    const status = (row && row.dataset.status) || statusForPath(filePath);
    const hit = (state.diffFiles || []).find((f) => f.path === filePath);
    vscode.postMessage(
      targetsPayload({
        command: 'openDiff',
        filePath,
        status,
        oldPath: (row && row.dataset.oldPath) || (hit && hit.oldPath) || '',
      })
    );
  }
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) {
    return CSS.escape(value);
  }
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function onFileTreeKeydown(e) {
  const groupHdr = e.target.closest && e.target.closest('.scm-group');
  if (groupHdr && groupHdr.dataset.status && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    toggleGroupCollapsed(groupHdr.dataset.status);
    return;
  }

  const files = state.diffFiles || [];
  if (!files.length) {
    return;
  }
  const paths = sortFilesForDisplay(files)
    .filter((f) => !isGroupCollapsed(f.status))
    .map((f) => f.path);
  if (!paths.length) {
    return;
  }
  let idx = paths.indexOf(state.selectedPath);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(paths.length - 1, Math.max(0, idx) + 1);
    selectPath(paths[idx], false);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(0, (idx < 0 ? 0 : idx) - 1);
    selectPath(paths[idx], false);
  } else if (e.key === 'Enter' && state.selectedPath) {
    e.preventDefault();
    selectPath(state.selectedPath, true);
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    bumpListFont(1);
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    bumpListFont(-1);
  }
}

function bumpListFont(delta) {
  state.listFontSize = clampFontSize((state.listFontSize || 12) + delta);
  applyListFontSize();
  saveState();
}

function applyListFontSize() {
  const px = clampFontSize(state.listFontSize || 12);
  state.listFontSize = px;
  if (fileTree) {
    fileTree.style.setProperty('--list-font-size', `${px}px`);
  }
  if (fontSizeLabel) {
    fontSizeLabel.textContent = String(px);
  }
  if (fontMinus) {
    fontMinus.disabled = px <= FONT_MIN;
  }
  if (fontPlus) {
    fontPlus.disabled = px >= FONT_MAX;
  }
}

function applyEndpoints(data) {
  if (typeof data.pathCaseInsensitive === 'boolean') {
    state.pathCaseInsensitive = data.pathCaseInsensitive;
  }

  const incoming = data.endpoints || [];
  if (data.partial && state.endpoints && state.endpoints.length) {
    const map = new Map(state.endpoints.map((e) => [e.id, e]));
    incoming.forEach((e) => map.set(e.id, e));
    state.endpoints = [...map.values()];
  } else if (incoming.length) {
    state.endpoints = incoming;
  }

  if (data.id1) {
    state.id1 = data.id1;
  }
  if (data.id2) {
    state.id2 = data.id2;
  }
  if (data.root1) {
    state.root1 = normalizeRoot(data.root1);
  }
  if (data.root2) {
    state.root2 = normalizeRoot(data.root2);
  }
  if (data.ref1) {
    state.ref1 = data.ref1;
  }
  if (data.ref2) {
    state.ref2 = data.ref2;
  }
  if (data.label1) {
    state.label1 = data.label1;
  }
  if (data.label2) {
    state.label2 = data.label2;
  }

  // Prefer host ids; fall back to root+ref match from saved state.
  if (!state.id1 && state.root1 && state.ref1) {
    const hit = state.endpoints.find(
      (e) => rootKey(e.root) === rootKey(state.root1) && e.ref === state.ref1
    );
    if (hit) {
      state.id1 = hit.id;
    }
  }
  if (!state.id2 && state.root2 && state.ref2) {
    const hit = state.endpoints.find(
      (e) => rootKey(e.root) === rootKey(state.root2) && e.ref === state.ref2
    );
    if (hit) {
      state.id2 = hit.id;
    }
  }

  syncSelectsFromState();

  if (state.root1 && state.root2 && state.ref1 && state.ref2 && state.id1 !== state.id2) {
    loadDiff();
  }
}

function onCommitSearch(e) {
  const query = e.target.value.toLowerCase();
  renderCommits(
    state.commits.filter(
      (c) =>
        c.message.toLowerCase().includes(query) ||
        c.author.toLowerCase().includes(query) ||
        c.shortHash.toLowerCase().includes(query)
    )
  );
}

function splitPath(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  if (i < 0) {
    return { dir: '', base: norm };
  }
  return { dir: norm.slice(0, i), base: norm.slice(i + 1) };
}

const STATUS_LETTER = {
  added: 'U',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  unknown: '?',
};

const STATUS_GROUP_ORDER = [
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'typechange',
  'unknown',
];

const STATUS_GROUP_LABEL = {
  modified: 'Modified',
  added: 'New (U)',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  typechange: 'Type change',
  unknown: 'Other',
};

function statusRank(status) {
  const i = STATUS_GROUP_ORDER.indexOf(status);
  return i < 0 ? 99 : i;
}

function sortFilesForDisplay(files) {
  return files.slice().sort((a, b) => {
    const ra = statusRank(a.status);
    const rb = statusRank(b.status);
    if (ra !== rb) {
      return ra - rb;
    }
    return a.path.localeCompare(b.path);
  });
}

function isGroupCollapsed(status) {
  return state.collapsedGroups && state.collapsedGroups.has(status);
}

function toggleGroupCollapsed(status) {
  if (!state.collapsedGroups) {
    state.collapsedGroups = new Set();
  }
  if (state.collapsedGroups.has(status)) {
    state.collapsedGroups.delete(status);
  } else {
    state.collapsedGroups.add(status);
  }
  saveState();
  renderFileTree(state.diffFiles || [], state.totalStats || { additions: 0, deletions: 0 }, true);
}

function renderFileTree(files, totalStats, isRestore = false, meta) {
  if (!isRestore) {
    state.diffFiles = files;
    state.totalStats = totalStats;
    if (meta) {
      state.label1 = meta.label1 || state.label1;
      state.label2 = meta.label2 || state.label2;
    }
  }

  const n = files.length;
  changesCount.textContent = n === 1 ? '1 change' : `${n} changes`;

  const add = totalStats.additions || 0;
  const del = totalStats.deletions || 0;
  if (add > 0) {
    totalAdditions.hidden = false;
    totalAdditions.textContent = `+${add}`;
  } else {
    totalAdditions.hidden = true;
    totalAdditions.textContent = '';
  }
  if (del > 0) {
    totalDeletions.hidden = false;
    totalDeletions.textContent = `−${del}`;
  } else {
    totalDeletions.hidden = true;
    totalDeletions.textContent = '';
  }

  updateCompareContext();
  applyListFontSize();

  if (files.length === 0) {
    fileTree.innerHTML = '<div class="empty-state">No changes between targets</div>';
    state.selectedPath = '';
    if (!isRestore) {
      saveState();
    }
    return;
  }

  if (!isRestore) {
    saveState();
  }

  const fragment = document.createDocumentFragment();
  const sorted = sortFilesForDisplay(files);
  const keepSelection =
    state.selectedPath && sorted.some((f) => f.path === state.selectedPath);
  if (!keepSelection) {
    state.selectedPath = '';
  }

  const counts = {};
  sorted.forEach((f) => {
    counts[f.status] = (counts[f.status] || 0) + 1;
  });

  let lastStatus = null;
  sorted.forEach((file) => {
    if (file.status !== lastStatus) {
      lastStatus = file.status;
      const collapsed = isGroupCollapsed(file.status);
      const group = document.createElement('div');
      group.className = `scm-group group-${file.status}${collapsed ? ' collapsed' : ''}`;
      group.dataset.status = file.status;
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const chevron = document.createElement('span');
      chevron.className = 'scm-group-chevron';
      chevron.textContent = collapsed ? '▸' : '▾';
      group.appendChild(chevron);
      const label = document.createElement('span');
      label.className = 'scm-group-label';
      const baseLabel = STATUS_GROUP_LABEL[file.status] || file.status;
      const c = counts[file.status] || 0;
      label.textContent = `${baseLabel} · ${c}`;
      group.appendChild(label);
      group.title = collapsed ? 'Expand group' : 'Collapse group';
      fragment.appendChild(group);
    }

    if (isGroupCollapsed(file.status)) {
      return;
    }

    const { dir, base } = splitPath(file.path);
    const row = document.createElement('div');
    row.className = `scm-resource status-${file.status}`;
    row.dataset.path = file.path;
    row.dataset.status = file.status;
    if (file.oldPath) {
      row.dataset.oldPath = file.oldPath;
    }
    row.dataset.type = 'file';
    row.setAttribute('role', 'option');
    const letter = STATUS_LETTER[file.status] || '?';
    row.title =
      file.status === 'added'
        ? `U  ${file.path} (open Target 2 only)`
        : file.status === 'deleted'
          ? `D  ${file.path} (open Target 1 only)`
          : file.oldPath
            ? `${letter}  ${file.oldPath} → ${file.path}`
            : `${letter}  ${file.path}`;
    if (file.path === state.selectedPath) {
      row.classList.add('selected');
    }

    const name = document.createElement('span');
    name.className = 'scm-name';
    name.textContent = base;
    row.appendChild(name);

    if (dir) {
      const pathEl = document.createElement('span');
      pathEl.className = 'scm-path';
      pathEl.textContent = dir;
      row.appendChild(pathEl);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'scm-path';
      spacer.textContent = '';
      row.appendChild(spacer);
    }

    const actions = document.createElement('span');
    actions.className = 'scm-actions';

    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'scm-action scm-action-discard';
    const removes = file.status === 'added';
    if (state.workingTree) {
      discardBtn.title = removes
        ? 'Delete this file from the working tree'
        : 'Restore this file from Target 1 into the working tree';
      discardBtn.setAttribute('aria-label', removes ? 'Delete from disk' : 'Restore from Target 1');
    } else {
      discardBtn.disabled = true;
      discardBtn.title =
        'Read-only: Target 2 is not the checked-out branch, so there is nothing on disk to change';
      discardBtn.setAttribute('aria-label', 'Unavailable: Target 2 is not checked out');
    }
    discardBtn.textContent = removes ? '␡' : '↺';
    actions.appendChild(discardBtn);

    if (file.status !== 'deleted') {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'scm-action scm-action-open';
      openBtn.title = 'Open Target 2 worktree file';
      openBtn.setAttribute('aria-label', 'Open');
      openBtn.textContent = '↗';
      actions.appendChild(openBtn);
    }
    row.appendChild(actions);

    if (file.binary) {
      // No line counts exist for an image or a PDF, and a silent blank column
      // reads like "nothing changed" — say why the numbers are missing.
      const stats = document.createElement('span');
      stats.className = 'scm-stats';
      const b = document.createElement('span');
      b.className = 'binary';
      b.textContent = 'bin';
      b.title = 'Binary file: opens in a viewer instead of a text diff';
      stats.appendChild(b);
      row.appendChild(stats);
    } else if (file.additions > 0 || file.deletions > 0) {
      const stats = document.createElement('span');
      stats.className = 'scm-stats';
      if (file.additions > 0) {
        const a = document.createElement('span');
        a.className = 'additions';
        a.textContent = `+${file.additions}`;
        stats.appendChild(a);
      }
      if (file.deletions > 0) {
        const d = document.createElement('span');
        d.className = 'deletions';
        d.textContent = `−${file.deletions}`;
        stats.appendChild(d);
      }
      row.appendChild(stats);
    }

    const letterEl = document.createElement('span');
    letterEl.className = `scm-status status-${file.status}`;
    letterEl.textContent = letter;
    letterEl.title =
      file.status === 'added'
        ? 'U — new on Target 2 (single view)'
        : file.status === 'modified'
          ? 'M — modified (side-by-side)'
          : file.status === 'deleted'
            ? 'D — only on Target 1 (single view)'
            : letter;
    row.appendChild(letterEl);

    fragment.appendChild(row);
  });

  fileTree.innerHTML = '';
  fileTree.appendChild(fragment);
}

function renderCommits(commits) {
  if (commits.length === 0) {
    commitList.innerHTML = sameRepo()
      ? '<div class="empty-state">No commits to display</div>'
      : '<div class="empty-state">Commit history needs the same repository on both targets</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  commits.forEach((commit) => {
    const item = document.createElement('div');
    item.className = 'commit-item';
    item.dataset.hash = commit.hash;

    const header = document.createElement('div');
    header.className = 'commit-header';

    const hash = document.createElement('span');
    hash.className = 'commit-hash';
    hash.textContent = commit.shortHash;
    header.appendChild(hash);

    const date = document.createElement('span');
    date.className = 'commit-date';
    date.textContent = commit.date;
    header.appendChild(date);

    const author = document.createElement('span');
    author.className = 'commit-author';
    author.textContent = commit.author;
    header.appendChild(author);

    item.appendChild(header);

    const message = document.createElement('div');
    message.className = 'commit-message';
    message.textContent = commit.message;
    item.appendChild(message);

    fragment.appendChild(item);
  });

  commitList.innerHTML = '';
  commitList.appendChild(fragment);
}

window.addEventListener('message', (event) => {
  const message = event.data;

  switch (message.command) {
    case 'endpoints':
      applyEndpoints(message.data);
      break;
    // Legacy no-ops (old webview state / hot reload)
    case 'repos':
    case 'branches':
      break;
    case 'diff':
      // Whether the right-hand side is the working tree decides if ↺ can do
      // anything: it writes to disk, and disk only belongs to a checked-out ref.
      state.workingTree = message.data.workingTree === true;
      renderFileTree(
        message.data.files,
        {
          additions: message.data.totalAdditions,
          deletions: message.data.totalDeletions,
        },
        false,
        { label1: message.data.label1, label2: message.data.label2 }
      );
      break;
    case 'discardDone':
      break;
    case 'commits':
      state.commits = message.data || [];
      renderCommits(state.commits);
      ensureCommitsCollapsed();
      updateCommitsTitle();
      saveState();
      break;
    case 'error': {
      console.error(message.message);
      // textContent: error strings can contain repo paths / git output —
      // never parse them as HTML.
      const div = document.createElement('div');
      div.className = 'empty-state';
      div.textContent = message.message;
      fileTree.innerHTML = '';
      fileTree.appendChild(div);
      break;
    }
  }
});

init();
